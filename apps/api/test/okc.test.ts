import { describe, expect, it } from 'vitest';
import { girisYap, kur } from './yardimci.js';

const KREM = '8690000000001';

async function ortam() {
  const o = await kur();
  const eczaci = await girisYap(o.app, o.kullanicilar.eczaci.eposta);
  const calisan = await girisYap(o.app, o.kullanicilar.calisan.eposta);
  await eczaci('PUT', `/api/urunler/${KREM}`, { ad: 'Nemlendirici Krem', kdvOrani: 20, satisFiyatiKurus: 25000 });
  await eczaci('POST', '/api/stok/giris', { barkod: KREM, miktar: 10, partiNo: 'A', skt: '2027-01-31', birimMaliyetKurus: 10000 });
  const sat = async (odemeTuru: 'nakit' | 'kart', miktar = 1) =>
    (await calisan('POST', '/api/satis', { kalemler: [{ barkod: KREM, miktar }], odemeTuru })).json() as { id: string };
  return { ...o, eczaci, calisan, sat };
}

describe('ÖKC ve POS', () => {
  it('nakit satışın fişini keser; aynı satışa ikinci fiş kesilmez', async () => {
    const { calisan, okc, sat } = await ortam();
    const s = await sat('nakit', 2);
    const f = await calisan('POST', `/api/satislar/${s.id}/fis`);
    expect(f.json()).toMatchObject({ durum: 'yazildi', fisNo: '0001', zNo: '0001', toplamKurus: 50000, odemeTuru: 'nakit' });
    expect(okc.fisler[0]).toMatchObject({ belgeId: s.id, toplamKurus: 50000, kalemler: [{ ad: 'Nemlendirici Krem', miktar: 2, kdvOrani: 20 }] });
    const tekrar = await calisan('POST', `/api/satislar/${s.id}/fis`);
    expect(tekrar.statusCode).toBe(409);
    expect(tekrar.json().hata).toContain('0001');
    expect((await calisan('POST', '/api/satislar/yok/fis')).statusCode).toBe(404);
  });

  it('kartlı satışta POS onayını fişe yazar; kart reddedilirse fiş kesilmez, yeniden denenebilir', async () => {
    const { calisan, okc, sat } = await ortam();
    const s = await sat('kart');
    okc.kartReddet = true;
    const red = await calisan('POST', `/api/satislar/${s.id}/fis`);
    expect(red.statusCode).toBe(502);
    expect(red.json()).toMatchObject({ durum: 'hata', hata: 'Kart reddedildi' });
    expect(okc.fisler).toHaveLength(0);
    okc.kartReddet = false;
    const f = (await calisan('POST', `/api/satislar/${s.id}/fis`)).json();
    expect(f).toMatchObject({ durum: 'yazildi', deneme: 2, kart: { maskeliKart: '4543 **** **** 0000' } });
    expect(f.hata).toBeUndefined();
    expect(okc.fisler[0]!.kartOnayKodu).toBe(f.kart.onayKodu);
  });

  it('kart çekildikten sonra ÖKC hata verirse kart yeniden çekilmez', async () => {
    const { calisan, okc, sat } = await ortam();
    const s = await sat('kart');
    const kartTahsilat = okc.kartTahsilat.bind(okc);
    let cekim = 0;
    okc.kartTahsilat = async (...a) => {
      cekim++;
      return kartTahsilat(...a);
    };
    const fisKes = okc.fisKes.bind(okc);
    okc.fisKes = async () => ({ basarili: false, hata: 'Kâğıt bitti' });
    expect((await calisan('POST', `/api/satislar/${s.id}/fis`)).json()).toMatchObject({ durum: 'hata', hata: 'Kâğıt bitti', kart: { onayKodu: expect.any(String) } });
    okc.fisKes = fisKes;
    expect((await calisan('POST', `/api/satislar/${s.id}/fis`)).json().durum).toBe('yazildi');
    expect(cekim).toBe(1);
  });

  it('gün özeti fişi kesilmemiş satışları gösterir; eczaneler birbirinin fişini görmez', async () => {
    const { calisan, app, kullanicilar, sat } = await ortam();
    const a = await sat('nakit');
    const b = await sat('kart');
    await calisan('POST', `/api/satislar/${a.id}/fis`);
    const o = (await calisan('GET', '/api/okc/gun')).json();
    expect(o).toMatchObject({ fisSayisi: 1, nakitKurus: 25000, kartKurus: 0 });
    expect(o.fissizSatislar.map((x: { satisId: string }) => x.satisId)).toEqual([b.id]);
    const baska = await girisYap(app, kullanicilar.baskaEczane.eposta);
    expect((await baska('POST', `/api/satislar/${a.id}/fis`)).statusCode).toBe(404);
    expect((await baska('GET', '/api/okc/gun')).json().fisler).toEqual([]);
  });
});
