import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { partiMaliyetleri, satisOzeti, stokRaporu } from '../src/rapor/rapor.js';
import type { Satis } from '../src/stok/stok.js';
import { girisYap, kur } from './yardimci.js';

const KREM = '8690000000001';
const SURUP = '8690000000002';

async function ortam() {
  const o = await kur();
  const eczaci = await girisYap(o.app, o.kullanicilar.eczaci.eposta);
  const calisan = await girisYap(o.app, o.kullanicilar.calisan.eposta);
  await eczaci('PUT', `/api/urunler/${KREM}`, { ad: 'Krem', kdvOrani: 20, satisFiyatiKurus: 12000 });
  await eczaci('PUT', `/api/urunler/${SURUP}`, { ad: 'Şurup', kdvOrani: 10, satisFiyatiKurus: 5500 });
  // Krem: 10 kutu 60 TL maliyetle. Şurup: maliyeti girilmemiş, miadı yakın.
  await calisan('POST', '/api/stok/giris', { barkod: KREM, miktar: 10, partiNo: 'K1', skt: '2027-06-30', birimMaliyetKurus: 6000 });
  await calisan('POST', '/api/stok/giris', { barkod: SURUP, miktar: 5, partiNo: 'S1', skt: '2026-11-15' });
  const musteri = (await eczaci('POST', '/api/musteriler', { adSoyad: 'Ahmet Yılmaz' })).json();
  return { ...o, eczaci, calisan, musteri };
}

// Satışlar gerçek saatle yazılır; raporun günü tutsun diye saat, testlerin "bugün"üne sabitlenir.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-20T14:00:00+03:00'));
});
afterEach(() => vi.useRealTimers());

const sat = (barkod: string, miktar: number, odemeTuru = 'nakit', musteriId?: string) => ({ kalemler: [{ barkod, miktar }], odemeTuru, musteriId });

describe('gün raporu', () => {
  it('ciroyu ödeme türüne, KDV oranına göre ayırır; kârı maliyeti bilinen kutulardan hesaplar', async () => {
    const { calisan, eczaci, musteri } = await ortam();
    await calisan('POST', '/api/satis', sat(KREM, 2));
    await calisan('POST', '/api/satis', sat(SURUP, 1, 'kart'));
    await calisan('POST', '/api/satis', sat(KREM, 1, 'veresiye', musteri.id));
    await calisan('POST', `/api/musteriler/${musteri.id}/tahsilat`, { tutarKurus: 5000, odemeTuru: 'nakit' });

    const r = await eczaci('GET', '/api/rapor/gun?gun=2026-10-20');
    expect(r.statusCode).toBe(200);
    const { ozet, kasa, kapanis } = r.json();
    expect(ozet).toMatchObject({ adet: 3, ciroKurus: 41500, nakitKurus: 24000, kartKurus: 5500, veresiyeKurus: 12000, maliyetsizKutu: 1 });
    // Krem: 36000 KDV dahil → 6000 KDV, 30000 matrah. Şurup: 5500 → 500 KDV.
    expect(ozet.kdvDokumu).toEqual([
      { oran: 10, tutarKurus: 5500, matrahKurus: 5000, kdvKurus: 500 },
      { oran: 20, tutarKurus: 36000, matrahKurus: 30000, kdvKurus: 6000 },
    ]);
    expect(ozet.kdvKurus).toBe(6500);
    expect(ozet.maliyetKurus).toBe(18000);
    expect(ozet.brutKarKurus).toBe(12000);
    expect(kasa).toMatchObject({ beklenenNakitKurus: 29000, beklenenKartKurus: 5500, nakitTahsilatKurus: 5000 });
    expect(kapanis).toBeNull();
  });

  it('raporları yalnızca eczacı görür', async () => {
    const { calisan } = await ortam();
    for (const url of ['/api/rapor/gun', '/api/rapor/donem?bas=2026-10-01&bit=2026-10-20', '/api/rapor/stok', '/api/gun-sonu'])
      expect((await calisan('GET', url)).statusCode).toBe(403);
  });

  it('başka eczanenin satışları rapora girmez', async () => {
    const { app, kullanicilar, calisan } = await ortam();
    await calisan('POST', '/api/satis', sat(KREM, 1));
    const baska = await girisYap(app, kullanicilar.baskaEczane.eposta);
    expect((await baska('GET', '/api/rapor/gun')).json().ozet.adet).toBe(0);
  });
});

describe('kasa kapanışı', () => {
  it('beklenenle sayılan aynıysa açıklamasız kapanır; gün ikinci kez kapanmaz', async () => {
    const { calisan, eczaci } = await ortam();
    await calisan('POST', '/api/satis', sat(KREM, 1));
    expect((await calisan('GET', '/api/gun-sonu/durum')).json()).toEqual({ gun: '2026-10-20', kapali: false });

    const r = await calisan('POST', '/api/gun-sonu', { sayilanNakitKurus: 12000 });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ gun: '2026-10-20', kapatan: 'Ali Tekin', satisAdedi: 1, farkKurus: 0 });
    expect((await calisan('GET', '/api/gun-sonu/durum')).json()).toMatchObject({ kapali: true, kapatan: 'Ali Tekin' });
    expect((await eczaci('GET', '/api/rapor/gun')).json().kapanis).toMatchObject({ sayilanNakitKurus: 12000 });

    expect((await eczaci('POST', '/api/gun-sonu', { sayilanNakitKurus: 12000 })).statusCode).toBe(409);
    expect((await eczaci('GET', '/api/gun-sonu')).json()).toHaveLength(1);
  });

  it('kasa farkı varsa açıklama ister ve farkı kaydeder', async () => {
    const { calisan } = await ortam();
    await calisan('POST', '/api/satis', sat(KREM, 1));
    const r = await calisan('POST', '/api/gun-sonu', { sayilanNakitKurus: 11000 });
    expect(r.statusCode).toBe(422);
    expect(r.json().farkKurus).toBe(-1000);
    const k = await calisan('POST', '/api/gun-sonu', { sayilanNakitKurus: 11000, aciklama: 'Para üstü yanlış verildi' });
    expect(k.json()).toMatchObject({ farkKurus: -1000, aciklama: 'Para üstü yanlış verildi' });
  });

  it('ileri bir gün ya da geçersiz tutar kapatılamaz', async () => {
    const { calisan } = await ortam();
    expect((await calisan('POST', '/api/gun-sonu', { gun: '2026-10-21', sayilanNakitKurus: 0 })).statusCode).toBe(400);
    expect((await calisan('POST', '/api/gun-sonu', { sayilanNakitKurus: -5 })).statusCode).toBe(400);
    expect((await calisan('POST', '/api/gun-sonu', { sayilanNakitKurus: 10.5 })).statusCode).toBe(400);
  });
});

describe('dönem ve stok raporu', () => {
  it('dönemi gün gün döker ve en çok satanları sıralar', async () => {
    const { calisan, eczaci } = await ortam();
    await calisan('POST', '/api/satis', sat(KREM, 3));
    await calisan('POST', '/api/satis', sat(SURUP, 2));
    const r = (await eczaci('GET', '/api/rapor/donem?bas=2026-10-18&bit=2026-10-20')).json();
    expect(r.gunler.map((g: { gun: string; adet: number }) => [g.gun, g.adet])).toEqual([
      ['2026-10-18', 0],
      ['2026-10-19', 0],
      ['2026-10-20', 2],
    ]);
    expect(r.toplam.ciroKurus).toBe(47000);
    expect(r.urunler.map((u: { ad: string }) => u.ad)).toEqual(['Krem', 'Şurup']);
  });

  it('dönem sınırlarını denetler', async () => {
    const { eczaci } = await ortam();
    expect((await eczaci('GET', '/api/rapor/donem?bas=2026-10-20&bit=2026-10-01')).statusCode).toBe(400);
    expect((await eczaci('GET', '/api/rapor/donem?bas=2024-01-01&bit=2026-10-20')).statusCode).toBe(400);
    expect((await eczaci('GET', '/api/rapor/donem?bas=x&bit=2026-10-20')).statusCode).toBe(400);
  });

  it('stok değerini maliyet ve raf fiyatıyla verir, miadı yaklaşanları listeler', async () => {
    const { calisan, eczaci } = await ortam();
    await calisan('POST', '/api/satis', sat(KREM, 4));
    const r = (await eczaci('GET', '/api/rapor/stok')).json();
    expect(r.toplam).toEqual({ cesit: 2, kutu: 11, maliyetKurus: 36000, satisDegeriKurus: 6 * 12000 + 5 * 5500, maliyetsizKutu: 5, miadiGecmisKutu: 0 });
    expect(r.miad).toEqual([{ barkod: SURUP, ad: 'Şurup', partiNo: 'S1', skt: '2026-11-15', miktar: 5, kalanGun: 26 }]);
  });
});

describe('rapor hesapları', () => {
  it('aynı partiye farklı maliyetle iki giriş ağırlıklı ortalama alır', () => {
    const m = partiMaliyetleri([
      { barkod: KREM, partiNo: 'K1', skt: '2027-01-01', miktar: 10, birimMaliyetKurus: 1000 },
      { barkod: KREM, partiNo: 'K1', skt: '2027-01-01', miktar: 30, birimMaliyetKurus: 2000 },
      { barkod: KREM, partiNo: 'K2', skt: '2027-01-01', miktar: 5 },
    ]);
    expect(m.get(`${KREM}|K1|2027-01-01`)).toBe(1750);
    expect(m.has(`${KREM}|K2|2027-01-01`)).toBe(false);
  });

  it('miadı geçmiş partiyi stok değerinde ayrıca sayar', () => {
    const r = stokRaporu(
      [{ barkod: KREM, ad: 'Krem', ilac: false, kdvOrani: 20, satisFiyatiKurus: 1000 }],
      new Map([[KREM, [{ partiNo: 'E', skt: '2026-10-01', miktar: 2 }]]]),
      new Map(),
      '2026-10-20',
    );
    expect(r.toplam.miadiGecmisKutu).toBe(2);
    expect(r.miad[0]!.kalanGun).toBe(-19);
  });

  it('boş günün özeti sıfırdır', () => {
    expect(satisOzeti([] as Satis[], new Map())).toMatchObject({ adet: 0, ciroKurus: 0, brutKarKurus: 0, kdvDokumu: [] });
  });
});
