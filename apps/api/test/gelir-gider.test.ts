import { describe, expect, it } from 'vitest';
import { gecerliHareketler, gelirGiderOzeti, hareketDogrula, kasaEtkisi, type KasaHareketi } from '../src/gelir-gider/gelir-gider.js';
import { girisYap, kur } from './yardimci.js';

const BUGUN = '2026-10-20';

describe('gelir-gider hesapları', () => {
  it('doğrular: kategori türe uymalı, "diğer" açıklama ister, ileri tarih olmaz', () => {
    expect(hareketDogrula({ tur: 'gider', kategori: 'faiz', tutarKurus: 100, odemeTuru: 'nakit', tarih: BUGUN }, BUGUN)[0]).toContain('Kategori');
    expect(hareketDogrula({ tur: 'gelir', kategori: 'diger', tutarKurus: 100, odemeTuru: 'nakit', tarih: BUGUN }, BUGUN)).toEqual([
      '"Diğer" kategorisinde açıklama yazın',
    ]);
    expect(hareketDogrula({ tur: 'gider', kategori: 'kira', tutarKurus: 0, odemeTuru: 'cek' as never, tarih: '2026-10-21' }, BUGUN)).toHaveLength(3);
  });

  it('iptal edilen kayıt ve iptal kaydı hesaba girmez; kasa etkisi yalnız nakit ve kartı sayar', () => {
    const h = (id: string, tur: KasaHareketi['tur'], tutarKurus: number, odemeTuru: KasaHareketi['odemeTuru'], ek: Partial<KasaHareketi> = {}) =>
      ({ id, tur, kategori: tur === 'gider' ? 'kira' : 'faiz', tutarKurus, odemeTuru, tarih: BUGUN, ...ek }) as KasaHareketi;
    const liste = [h('1', 'gider', 5000, 'nakit'), h('2', 'gider', 3000, 'nakit'), h('2-iptal', 'gider', 3000, 'nakit', { iptalEdilenId: '2' }), h('3', 'gelir', 700, 'kart'), h('4', 'gider', 9000, 'havale')];
    expect(gecerliHareketler(liste).map((x) => x.id)).toEqual(['1', '3', '4']);
    expect(kasaEtkisi(gecerliHareketler(liste))).toEqual({ nakitGelirKurus: 0, nakitGiderKurus: 5000, kartGelirKurus: 700 });
    expect(gelirGiderOzeti(liste)).toMatchObject({ gelirKurus: 700, giderKurus: 14000, netKurus: -13300 });
  });
});

describe('gelir-gider API ve gün sonu', () => {
  it('nakit gider ve nakit depo ödemesi kasa beklentisinden düşer; kapanan güne kayıt girilmez', async () => {
    const { app, kullanicilar } = await kur();
    const eczaci = await girisYap(app, kullanicilar.eczaci.eposta);
    const calisan = await girisYap(app, kullanicilar.calisan.eposta);

    const gider = await calisan('POST', '/api/gelir-gider', { tur: 'gider', kategori: 'temizlik', tutarKurus: 4500, odemeTuru: 'nakit', tarih: BUGUN });
    expect(gider.statusCode).toBe(201);
    await eczaci('POST', '/api/gelir-gider', { tur: 'gelir', kategori: 'diger', aciklama: 'Fotokopi', tutarKurus: 1000, odemeTuru: 'nakit', tarih: BUGUN });
    await eczaci('POST', '/api/gelir-gider', { tur: 'gider', kategori: 'kira', tutarKurus: 2000000, odemeTuru: 'havale', tarih: BUGUN });
    const depo = (await eczaci('POST', '/api/tedarikciler', { ad: 'Depo' })).json();
    await eczaci('POST', `/api/depo-carisi/${depo.id}/odeme`, { tutarKurus: 2500, odemeTuru: 'nakit', tarih: BUGUN });

    const kasa = (await eczaci('GET', '/api/rapor/gun')).json().kasa;
    expect(kasa).toMatchObject({ nakitGelirKurus: 1000, nakitGiderKurus: 7000, beklenenNakitKurus: -6000 });

    expect((await calisan('GET', '/api/gelir-gider')).statusCode).toBe(403);
    const d = (await eczaci('GET', `/api/gelir-gider?bas=${BUGUN}&bit=${BUGUN}`)).json();
    expect(d.kayitlar).toHaveLength(3);
    expect(d.ozet).toMatchObject({ gelirKurus: 1000, giderKurus: 2004500 });

    // Kasa kapanınca o güne nakit kayıt ve kapanmış güne dokunan iptal yapılamaz; havale yapılabilir.
    await eczaci('POST', '/api/gun-sonu', { sayilanNakitKurus: 0, aciklama: 'Kasadan para çıktı' });
    expect((await calisan('POST', '/api/gelir-gider', { tur: 'gider', kategori: 'temizlik', tutarKurus: 100, odemeTuru: 'nakit', tarih: BUGUN })).statusCode).toBe(409);
    expect((await eczaci('POST', `/api/depo-carisi/${depo.id}/odeme`, { tutarKurus: 100, odemeTuru: 'nakit', tarih: BUGUN })).statusCode).toBe(409);
    expect((await eczaci('POST', '/api/gelir-gider', { tur: 'gider', kategori: 'muhasebe', tutarKurus: 100, odemeTuru: 'havale', tarih: BUGUN })).statusCode).toBe(201);
    expect((await eczaci('POST', `/api/gelir-gider/${gider.json().id}/iptal`, { aciklama: 'Yanlış girildi' })).statusCode).toBe(409);
  });

  it('kayıt iptali: yalnızca eczacı, bir kez, nedeniyle', async () => {
    const { app, kullanicilar } = await kur();
    const eczaci = await girisYap(app, kullanicilar.eczaci.eposta);
    const calisan = await girisYap(app, kullanicilar.calisan.eposta);
    const k = (await calisan('POST', '/api/gelir-gider', { tur: 'gider', kategori: 'kirtasiye-sarf', tutarKurus: 900, odemeTuru: 'nakit', tarih: BUGUN })).json();
    expect((await calisan('POST', `/api/gelir-gider/${k.id}/iptal`, { aciklama: 'Yanlış girildi' })).statusCode).toBe(403);
    expect((await eczaci('POST', `/api/gelir-gider/${k.id}/iptal`, { aciklama: 'x' })).statusCode).toBe(400);
    expect((await eczaci('POST', `/api/gelir-gider/${k.id}/iptal`, { aciklama: 'Yanlış girildi' })).statusCode).toBe(201);
    expect((await eczaci('POST', `/api/gelir-gider/${k.id}/iptal`, { aciklama: 'Yanlış girildi' })).statusCode).toBe(409);
    expect((await eczaci('POST', `/api/gelir-gider/${k.id}-iptal/iptal`, { aciklama: 'Yanlış girildi' })).statusCode).toBe(404);
    expect((await eczaci('GET', '/api/rapor/gun')).json().kasa.nakitGiderKurus).toBe(0);
  });
});
