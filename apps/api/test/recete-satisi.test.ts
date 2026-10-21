import { describe, expect, it } from 'vitest';
import { ornekIlacKurallari, ornekReceteler, type Recete } from '@scalpiq/sut-motoru';
import { icmalHazirla, receteKatilimi, tutarHesapla, type KatilimAyarlari, type ReceteSatisi } from '../src/recete-satisi/recete-satisi.js';
import { girisYap, kur } from './yardimci.js';

const ILAC = '8690000000011';
const recete = (no = 'E-1001'): Recete => structuredClone(ornekReceteler.find((o) => o.recete.no === no)!.recete);
// Test için uydurulmuş katılım payı ayarları; gerçek tutarları eczacı SUT'tan girer.
const AYAR: Omit<KatilimAyarlari, 'onaylayan' | 'tarih'> = {
  ilacKatilimYuzde: 20,
  receteKatilim: { ilkKutuSayisi: 3, ilkKutularKurus: 300, sonrakiKutuKurus: 100 },
  muayeneKurus: 0,
};
const ayar = { ...AYAR, onaylayan: 'X', tarih: '2026-10-01' };

describe('hasta payı hesabı', () => {
  it('fiyat farkı, ilaç ve reçete katılım payı; kurum payı kalanı', () => {
    const t = tutarHesapla(
      [
        { adet: 2, birimFiyatKurus: 10000, kamuBedeliKurus: 9000 },
        { adet: 3, birimFiyatKurus: 5000, kamuBedeliKurus: 5000 },
      ],
      undefined,
      ayar,
      false,
    );
    // Toplam 350 TL; kamu bedeli 330 TL; fiyat farkı 20 TL; ilaç katılımı 330 × %20 = 66 TL; 5 kutu: 3 TL + 2 × 1 TL
    expect(t).toEqual({
      toplamKurus: 35000,
      fiyatFarkiKurus: 2000,
      ilacKatilimKurus: 6600,
      receteKatilimKurus: 500,
      muayeneKurus: 0,
      hastaPayiKurus: 9100,
      kurumPayiKurus: 25900,
      kaynak: 'ayar',
    });
    expect(tutarHesapla([{ adet: 1, birimFiyatKurus: 10000, kamuBedeliKurus: 10000 }], undefined, ayar, true).hastaPayiKurus).toBe(0);
    expect(receteKatilimi(2, ayar.receteKatilim)).toBe(300);
  });

  it('Medula tutarları verilirse onlar geçerli; ayar da tutar da yoksa hata', () => {
    const t = tutarHesapla([{ adet: 1, birimFiyatKurus: 10000, kamuBedeliKurus: 10000 }], { ilacKatilimKurus: 1234, receteKatilimKurus: 300, muayeneKurus: 0 }, undefined, false);
    expect(t).toMatchObject({ hastaPayiKurus: 1534, kurumPayiKurus: 8466, kaynak: 'medula' });
    expect(() => tutarHesapla([{ adet: 1, birimFiyatKurus: 100, kamuBedeliKurus: 100 }], { ilacKatilimKurus: 10 }, undefined, false)).toThrow('katılım payı ayarlarını');
    // Hasta payı reçete tutarını aşamaz
    expect(tutarHesapla([{ adet: 1, birimFiyatKurus: 100, kamuBedeliKurus: 100 }], { ilacKatilimKurus: 500, receteKatilimKurus: 300, muayeneKurus: 0 }, undefined, false)).toMatchObject({
      hastaPayiKurus: 100,
      kurumPayiKurus: 0,
    });
  });

  it('icmal yalnızca dönemin satılmış reçetelerini toplar ve türe göre döker', () => {
    const s = (id: string, tarih: string, durum: ReceteSatisi['durum'], receteTuru: ReceteSatisi['receteTuru'] = 'normal') =>
      ({ id, receteNo: id, kurum: 'SGK', tarih, durum, receteTuru, tutarlar: { toplamKurus: 1000, kurumPayiKurus: 800, hastaPayiKurus: 200 } }) as ReceteSatisi;
    const i = icmalHazirla('SGK', '2026-10', [s('a', '2026-10-01', 'satildi'), s('b', '2026-10-05', 'satildi', 'yesil'), s('c', '2026-10-06', 'iptal'), s('d', '2026-09-30', 'satildi')], 'X', 'z');
    expect(i).toMatchObject({ id: 'SGK:2026-10', receteSayisi: 2, toplamKurus: 2000, kurumPayiKurus: 1600, hastaPayiKurus: 400 });
    expect(i.dokum.map((d) => [d.receteTuru, d.receteSayisi])).toEqual([
      ['normal', 1],
      ['yesil', 1],
    ]);
  });
});

async function ortam() {
  const o = await kur(ornekIlacKurallari);
  const eczaci = await girisYap(o.app, o.kullanicilar.eczaci.eposta);
  const calisan = await girisYap(o.app, o.kullanicilar.calisan.eposta);
  await eczaci('PUT', `/api/urunler/${ILAC}`, { ad: 'KARDIOX 75 MG 28 TABLET', kdvOrani: 10, satisFiyatiKurus: 20000 });
  await eczaci('POST', '/api/stok/giris', { barkod: ILAC, miktar: 5, partiNo: 'K1', skt: '2027-12-31', birimMaliyetKurus: 15000 });
  const gonderilmis = async (no = 'E-1001') => {
    const k = (await calisan('POST', '/api/kontrol', { recete: recete(no) })).json();
    expect((await calisan('POST', '/api/gonder', { kontrolId: k.kontrolId })).statusCode).toBe(200);
    return k.kontrolId as string;
  };
  return { ...o, eczaci, calisan, gonderilmis };
}

describe('reçeteli satış API', () => {
  it('gönderilmiş reçeteyi satar, stoktan düşer, hasta payı kasaya, kurum payı SGK carisine yazılır', async () => {
    const { eczaci, calisan, gonderilmis } = await ortam();
    const k = (await calisan('POST', '/api/kontrol', { recete: recete() })).json();
    expect((await calisan('POST', '/api/recete-satislari', { kontrolId: k.kontrolId, hastaOdemeTuru: 'nakit' })).json().hata).toContain('gönderilmemiş');

    const kontrolId = await gonderilmis();
    expect((await calisan('POST', '/api/recete-satislari', { kontrolId, hastaOdemeTuru: 'nakit' })).json().hata).toContain('katılım payı ayarlarını');
    expect((await calisan('PUT', '/api/recete-satislari/katilim-ayarlari', AYAR)).statusCode).toBe(403);
    expect((await eczaci('PUT', '/api/recete-satislari/katilim-ayarlari', AYAR)).json()).toMatchObject({ onaylayan: 'Ecz. Serkan Kaya' });

    const on = (await calisan('POST', '/api/recete-satislari/hesapla', { kontrolId, kamuBedelleri: { [ILAC]: 18000 } })).json();
    // 200 TL; kamu bedeli 180 TL: fiyat farkı 20 TL + %20 = 36 TL + reçete 3 TL = 59 TL
    expect(on.tutarlar).toMatchObject({ toplamKurus: 20000, hastaPayiKurus: 5900, kurumPayiKurus: 14100 });

    const s = await calisan('POST', '/api/recete-satislari', { kontrolId, hastaOdemeTuru: 'nakit', kamuBedelleri: { [ILAC]: 18000 } });
    expect(s.statusCode).toBe(201);
    expect(s.json()).toMatchObject({ durum: 'satildi', receteNo: 'E-1001', takipNo: expect.stringContaining('SAHTE'), kalemler: [{ partiler: [{ partiNo: 'K1', miktar: 1 }] }] });
    expect((await calisan('POST', '/api/recete-satislari', { kontrolId, hastaOdemeTuru: 'nakit' })).statusCode).toBe(409);
    expect(((await eczaci('GET', '/api/stok')).json() as { miktar: number }[])[0]!.miktar).toBe(4);

    expect((await eczaci('GET', '/api/rapor/gun')).json().kasa).toMatchObject({ nakitReceteKurus: 5900, beklenenNakitKurus: 5900 });
    expect((await eczaci('GET', '/api/kurum-carisi')).json()).toMatchObject({ kurum: 'SGK', alacakKurus: 14100, bakiyeKurus: 14100, faturalanmamisKurus: 14100 });
    expect((await calisan('GET', '/api/recete-satislari?donem=2026-10')).json()).toHaveLength(1);
  });

  it('dönem icmali: taslak yenilenir, fatura kesilince kilitlenir; SGK ödemesi bakiyeyi kapatır', async () => {
    const { eczaci, calisan, gonderilmis } = await ortam();
    await eczaci('PUT', '/api/recete-satislari/katilim-ayarlari', AYAR);
    const kontrolId = await gonderilmis();
    const s = (await calisan('POST', '/api/recete-satislari', { kontrolId, hastaOdemeTuru: 'kart' })).json();

    expect((await eczaci('POST', '/api/icmaller', { donem: '2026-11' })).statusCode).toBe(400);
    const taslak = (await eczaci('POST', '/api/icmaller', { donem: '2026-10' })).json();
    expect(taslak).toMatchObject({ id: 'SGK:2026-10', durum: 'taslak', receteSayisi: 1, kurumPayiKurus: s.tutarlar.kurumPayiKurus });
    expect((await eczaci('POST', '/api/icmaller/2026-09/kes', { faturaNo: 'F1', faturaTarihi: '2026-10-20' })).json().hata).toContain('reçete yok');

    const kes = await eczaci('POST', '/api/icmaller/2026-10/kes', { faturaNo: 'ECZ2026000045', faturaTarihi: '2026-10-20' });
    expect(kes.json()).toMatchObject({ durum: 'kesildi', fatura: { no: 'ECZ2026000045' } });
    expect((await eczaci('POST', '/api/icmaller', { donem: '2026-10' })).statusCode).toBe(409);
    expect((await eczaci('POST', `/api/recete-satislari/${s.id}/iptal`, { neden: 'Yanlış ilaç verildi' })).json().hata).toContain('faturası kesilmiş');
    const ikinci = await gonderilmis();
    expect((await calisan('POST', '/api/recete-satislari', { kontrolId: ikinci, hastaOdemeTuru: 'nakit' })).json().hata).toContain('faturası kesilmiş');

    await eczaci('POST', '/api/kurum-carisi/tahsilat', { tutarKurus: s.tutarlar.kurumPayiKurus, tarih: '2026-10-20', icmalId: 'SGK:2026-10' });
    expect((await eczaci('GET', '/api/kurum-carisi')).json()).toMatchObject({ bakiyeKurus: 0, faturalanmamisKurus: 0 });
  });

  it('iptal stoğu geri alır ve kasadan düşer; veresiye hasta payı müşteri borcuna yazılır', async () => {
    const { eczaci, calisan, gonderilmis } = await ortam();
    await eczaci('PUT', '/api/recete-satislari/katilim-ayarlari', AYAR);
    const s = (await calisan('POST', '/api/recete-satislari', { kontrolId: await gonderilmis(), hastaOdemeTuru: 'nakit' })).json();
    expect((await calisan('POST', `/api/recete-satislari/${s.id}/iptal`, { neden: 'Yanlış ilaç verildi' })).statusCode).toBe(403);
    expect((await eczaci('POST', `/api/recete-satislari/${s.id}/iptal`, { neden: 'Yanlış ilaç verildi' })).json().durum).toBe('iptal');
    expect((await eczaci('POST', `/api/recete-satislari/${s.id}/iptal`, { neden: 'Yanlış ilaç verildi' })).statusCode).toBe(404);
    expect(((await eczaci('GET', '/api/stok')).json() as { miktar: number }[])[0]!.miktar).toBe(5);
    expect((await eczaci('GET', '/api/rapor/gun')).json().kasa.nakitReceteKurus).toBe(0);

    const m = (await eczaci('POST', '/api/musteriler', { adSoyad: 'Hasan Çelik' })).json();
    const v = (await calisan('POST', '/api/recete-satislari', { kontrolId: await gonderilmis(), hastaOdemeTuru: 'veresiye', musteriId: m.id })).json();
    expect((await calisan('GET', `/api/musteriler/${m.id}`)).json().bakiyeKurus).toBe(v.tutarlar.hastaPayiKurus);
    expect((await eczaci('POST', `/api/recete-satislari/${v.id}/iptal`, { neden: 'Yanlış ilaç verildi' })).json().hata).toContain('Veresiye');
  });

  it('stok yetmezse satış yazılmaz ve stok gelince yeniden denenebilir', async () => {
    const { eczaci, calisan, gonderilmis } = await ortam();
    await eczaci('PUT', '/api/recete-satislari/katilim-ayarlari', AYAR);
    await eczaci('POST', '/api/stok/imha', { barkod: ILAC, partiNo: 'K1', skt: '2027-12-31', miktar: 5, aciklama: 'Kırık ambalajlar' });
    const kontrolId = await gonderilmis();
    expect((await calisan('POST', '/api/recete-satislari', { kontrolId, hastaOdemeTuru: 'nakit' })).statusCode).toBe(409);
    expect((await calisan('GET', '/api/recete-satislari')).json()).toEqual([]);
    await eczaci('POST', '/api/stok/giris', { barkod: ILAC, miktar: 1, partiNo: 'K2', skt: '2027-12-31', birimMaliyetKurus: 15000 });
    expect((await calisan('POST', '/api/recete-satislari', { kontrolId, hastaOdemeTuru: 'nakit' })).statusCode).toBe(201);
  });
});

describe('toplu reçete gönderimi', () => {
  it('her reçeteyi ayrı gönderir; kilitli olan diğerlerini durdurmaz', async () => {
    const o = await kur(ornekIlacKurallari);
    const istek = await girisYap(o.app, o.kullanicilar.calisan.eposta);
    const k1 = (await istek('POST', '/api/kontrol', { recete: recete('E-1001') })).json().kontrolId;
    const k2 = (await istek('POST', '/api/kontrol', { recete: recete('E-1002') })).json().kontrolId;
    const r = (await istek('POST', '/api/gonder/toplu', { gonderimler: [{ kontrolId: k1 }, { kontrolId: k2 }, { kontrolId: 'yok' }] })).json();
    expect(r).toMatchObject({ gonderilen: 1, kalan: 2 });
    expect(r.sonuclar.map((x: { basarili: boolean; hata?: string }) => [x.basarili, x.hata])).toEqual([
      [true, undefined],
      [false, 'Gönderim kilitli'],
      [false, 'Kontrol bulunamadı. Reçeteyi yeniden kontrol edin.'],
    ]);
    expect(o.medula.gonderilenler).toHaveLength(1);
    expect((await istek('POST', '/api/gonder/toplu', { gonderimler: [{ kontrolId: k1 }, { kontrolId: k1 }] })).statusCode).toBe(400);
  });
});
