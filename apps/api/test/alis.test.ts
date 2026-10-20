import { describe, expect, it } from 'vitest';
import { kalemHesapla, siparisOnerileri, type AlisFaturasi } from '../src/alis/alis.js';
import type { Urun } from '../src/stok/stok.js';
import { girisYap, kur } from './yardimci.js';

const KREM = '8690000000001';
const SAMPUAN = '8690000000002';

describe('alış hesapları', () => {
  it('iskontoyu KDV’den önce uygular, mal fazlasını maliyete dağıtır', () => {
    const k = kalemHesapla(
      { barkod: KREM, miktar: 10, malFazlasi: 2, partiNo: ' P1 ', skt: '2027-01-01', birimFiyatKurus: 10000, kdvOrani: 10, iskontoYuzde: 5 },
      'Krem',
    );
    expect(k).toMatchObject({ partiNo: 'P1', netKurus: 95000, kdvKurus: 9500, birimMaliyetKurus: 7917 });
  });

  it('kritik stoğa inen ürünler için sipariş önerir', () => {
    const urun = (barkod: string, kritikStok?: number): Urun => ({ barkod, ad: barkod, ilac: false, kdvOrani: 20, satisFiyatiKurus: 100, kritikStok });
    const stok = new Map([
      [KREM, [{ partiNo: 'A', skt: '2027-01-01', miktar: 1 }]],
      [SAMPUAN, [{ partiNo: 'B', skt: '2027-01-01', miktar: 50 }]],
    ]);
    const fatura = { tedarikciAd: 'Depo A', zaman: '2026-10-01', kalemler: [{ barkod: KREM, birimMaliyetKurus: 70 }] } as AlisFaturasi;
    const o = siparisOnerileri([urun(KREM, 5), urun(SAMPUAN, 5), urun('8690000000003')], stok, [fatura]);
    expect(o).toEqual([{ urun: urun(KREM, 5), stok: 1, oneri: 9, sonTedarikci: 'Depo A', sonMaliyetKurus: 70 }]);
  });
});

async function ortam() {
  const o = await kur();
  const eczaci = await girisYap(o.app, o.kullanicilar.eczaci.eposta);
  const calisan = await girisYap(o.app, o.kullanicilar.calisan.eposta);
  await eczaci('PUT', `/api/urunler/${KREM}`, { ad: 'Nemlendirici Krem', kdvOrani: 20, satisFiyatiKurus: 25000, kritikStok: 5 });
  const depo = (await eczaci('POST', '/api/tedarikciler', { ad: 'Örnek Ecza Deposu', vergiNo: '1234567890' })).json();
  return { ...o, eczaci, calisan, depo };
}

const fatura = (tedarikciId: string, ek: object = {}) => ({
  tedarikciId,
  faturaNo: 'ABC2026000001',
  tarih: '2026-10-19',
  kalemler: [
    { barkod: KREM, miktar: 10, malFazlasi: 1, partiNo: 'P1', skt: '2027-06-30', birimFiyatKurus: 15000, kdvOrani: 20 },
    { barkod: SAMPUAN, ad: 'Bebek Şampuanı', miktar: 6, partiNo: 'S1', skt: '2028-01-31', birimFiyatKurus: 8000, kdvOrani: 20, satisFiyatiKurus: 14990 },
  ],
  ...ek,
});

describe('alış faturası API', () => {
  it('tedarikçiyi yalnızca eczacı ekler; aynı ad iki kez eklenemez', async () => {
    const { eczaci, calisan } = await ortam();
    expect((await calisan('POST', '/api/tedarikciler', { ad: 'X' })).statusCode).toBe(403);
    expect((await eczaci('POST', '/api/tedarikciler', { ad: 'örnek ecza deposu' })).statusCode).toBe(409);
    expect((await eczaci('POST', '/api/tedarikciler', { ad: 'Y', vergiNo: '12' })).json().hatalar).toEqual(['Vergi numarası 10 ya da 11 haneli olmalı']);
  });

  it('faturayı kaydeder, stoğa mal fazlasıyla girer, eksik kartı açar', async () => {
    const { calisan, depo } = await ortam();
    const r = await calisan('POST', '/api/alis-faturalari', fatura(depo.id));
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ tedarikciAd: 'Örnek Ecza Deposu', netKurus: 198000, kdvKurus: 39600, toplamKurus: 237600, kaydeden: 'Ali Tekin' });

    const stok = (await calisan('GET', '/api/stok')).json();
    const krem = stok.find((s: { urun: Urun }) => s.urun.barkod === KREM);
    const sampuan = stok.find((s: { urun: Urun }) => s.urun.barkod === SAMPUAN);
    expect(krem.miktar).toBe(11);
    expect(sampuan.urun).toMatchObject({ ad: 'Bebek Şampuanı', satisFiyatiKurus: 14990, ilac: false });
    expect(sampuan.miktar).toBe(6);
    expect((await calisan('GET', '/api/alis-faturalari')).json()).toHaveLength(1);
  });

  it('aynı fatura iki kez girilemez ve ikinci deneme stoğa bir şey yazmaz', async () => {
    const { calisan, depo } = await ortam();
    await calisan('POST', '/api/alis-faturalari', fatura(depo.id));
    const tekrar = await calisan('POST', '/api/alis-faturalari', fatura(depo.id));
    expect(tekrar.statusCode).toBe(409);
    expect(tekrar.json().hata).toContain('zaten girilmiş');
    const krem = (await calisan('GET', '/api/stok')).json().find((s: { urun: Urun }) => s.urun.barkod === KREM);
    expect(krem.miktar).toBe(11);
  });

  it('hatalı faturayı satır numaralarıyla reddeder', async () => {
    const { calisan, depo } = await ortam();
    const r = await calisan('POST', '/api/alis-faturalari', {
      ...fatura(depo.id, { tarih: '2026-10-25' }),
      kalemler: [
        { barkod: KREM, miktar: 0, partiNo: 'P1', skt: '2026-01-01', birimFiyatKurus: 1, kdvOrani: 18 },
        { barkod: SAMPUAN, miktar: 1, partiNo: 'S', skt: '2027-01-01', birimFiyatKurus: 1, kdvOrani: 20 },
      ],
    });
    expect(r.json().hatalar).toEqual([
      'Fatura tarihi ileri bir gün olamaz',
      '1. satır: miktar 1 ya da daha büyük tamsayı olmalı',
      '1. satır: miadı geçmiş ürün stoğa alınamaz',
      '1. satır: KDV oranı 0, 1, 10 ya da 20 olmalı',
      '2. satır: ürün kartı yok, ürün adını yazın',
      '2. satır: ürün kartı yok, satış fiyatını yazın',
    ]);
  });

  it('başka eczanenin tedarikçisiyle fatura girilemez', async () => {
    const { app, kullanicilar, depo } = await ortam();
    const deniz = await girisYap(app, kullanicilar.baskaEczane.eposta);
    const r = await deniz('POST', '/api/alis-faturalari', fatura(depo.id));
    expect(r.json().hatalar).toContain('Tedarikçi bulunamadı');
  });

  it('sipariş önerisi kritik stoktaki ürünü son alış bilgisiyle verir', async () => {
    const { calisan, depo } = await ortam();
    expect((await calisan('GET', '/api/siparis-onerisi')).json()).toMatchObject([{ stok: 0, oneri: 10 }]);
    await calisan('POST', '/api/alis-faturalari', fatura(depo.id));
    expect((await calisan('GET', '/api/siparis-onerisi')).json()).toEqual([]);
    await calisan('POST', '/api/satis', { kalemler: [{ barkod: KREM, miktar: 8 }], odemeTuru: 'nakit' });
    expect((await calisan('GET', '/api/siparis-onerisi')).json()).toMatchObject([
      { stok: 3, oneri: 7, sonTedarikci: 'Örnek Ecza Deposu', sonMaliyetKurus: 13636 },
    ]);
  });
});
