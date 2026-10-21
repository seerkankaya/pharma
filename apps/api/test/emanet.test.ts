import { describe, expect, it } from 'vitest';
import { emanetDogrula, type Emanet } from '../src/emanet/emanet.js';
import { girisYap, kur } from './yardimci.js';

const KREM = '8690000000001';
const BUGUN = '2026-10-20';

async function ortam() {
  const o = await kur();
  const eczaci = await girisYap(o.app, o.kullanicilar.eczaci.eposta);
  const calisan = await girisYap(o.app, o.kullanicilar.calisan.eposta);
  await eczaci('PUT', `/api/urunler/${KREM}`, { ad: 'Nemlendirici Krem', kdvOrani: 20, satisFiyatiKurus: 25000 });
  await eczaci('POST', '/api/stok/giris', { barkod: KREM, miktar: 2, partiNo: 'A', skt: '2027-01-31', birimMaliyetKurus: 10000 });
  await eczaci('POST', '/api/stok/giris', { barkod: KREM, miktar: 5, partiNo: 'B', skt: '2027-06-30', birimMaliyetKurus: 10000 });
  const stokAdedi = async () => ((await eczaci('GET', '/api/stok')).json() as { miktar: number }[])[0]!.miktar;
  return { ...o, eczaci, calisan, stokAdedi };
}

describe('emanet doğrulama', () => {
  it('türüne göre zorunlu alanları ister', () => {
    expect(emanetDogrula({ tur: 'verilen', kisiAd: ' ', kalemler: [] }, BUGUN)).toEqual(['Hastanın adını yazın', 'En az bir ilaç girin']);
    expect(emanetDogrula({ tur: 'eczaneden-alinan', kisiAd: 'Deniz Eczanesi', kalemler: [{ barkod: KREM, miktar: 1, skt: '2026-01-01' }] }, BUGUN)).toEqual([
      '1. satır: gelen kutunun parti numarasını girin',
      '1. satır: miadı geçmiş ürün stoğa alınamaz',
    ]);
  });
});

describe('emanet API', () => {
  it('hastaya verilen emanet stoktan FEFO ile düşer, reçete gelince kapanır, iki kez kapanmaz', async () => {
    const { calisan, stokAdedi } = await ortam();
    const r = await calisan('POST', '/api/emanetler', { tur: 'verilen', kisiAd: 'Ayşe Yılmaz', telefon: '05551112233', kalemler: [{ barkod: KREM, miktar: 3 }] });
    expect(r.statusCode).toBe(201);
    const e = r.json() as Emanet;
    expect(e.kalemler[0]!.partiler).toEqual([
      { partiNo: 'A', skt: '2027-01-31', miktar: 2 },
      { partiNo: 'B', skt: '2027-06-30', miktar: 1 },
    ]);
    expect(await stokAdedi()).toBe(4);
    expect((await calisan('GET', '/api/emanetler?durum=acik')).json()).toHaveLength(1);

    expect((await calisan('POST', `/api/emanetler/${e.id}/kapat`, { sekil: 'recete' })).statusCode).toBe(400);
    expect((await calisan('POST', `/api/emanetler/${e.id}/kapat`, { sekil: 'teslim' })).json().hata).toBe('Bu emanet recete ya da iade ile kapanır');
    const k = await calisan('POST', `/api/emanetler/${e.id}/kapat`, { sekil: 'recete', receteNo: '3ABC123' });
    expect(k.json()).toMatchObject({ durum: 'kapandi', kapanis: { sekil: 'recete', receteNo: '3ABC123', kaydeden: 'Ali Tekin' } });
    expect((await calisan('POST', `/api/emanetler/${e.id}/kapat`, { sekil: 'recete', receteNo: 'X' })).statusCode).toBe(409);
    expect(await stokAdedi()).toBe(4);
    expect((await calisan('GET', '/api/emanetler?durum=acik')).json()).toHaveLength(0);
  });

  it('verilen emanet iade edilirse aynı partilerle stoğa döner', async () => {
    const { eczaci, stokAdedi } = await ortam();
    const e = (await eczaci('POST', '/api/emanetler', { tur: 'eczaneye-verilen', kisiAd: 'Deniz Eczanesi', kalemler: [{ barkod: KREM, miktar: 2 }] })).json();
    expect(await stokAdedi()).toBe(5);
    await eczaci('POST', `/api/emanetler/${e.id}/kapat`, { sekil: 'iade' });
    expect(await stokAdedi()).toBe(7);
  });

  it('bekleyen emanet teslimde düşer; stok yetmezse emanet açık kalır', async () => {
    const { eczaci, stokAdedi } = await ortam();
    const e = (await eczaci('POST', '/api/emanetler', { tur: 'bekleyen', kisiAd: 'Mehmet Demir', kalemler: [{ barkod: KREM, miktar: 9 }] })).json();
    expect(await stokAdedi()).toBe(7);
    const r = await eczaci('POST', `/api/emanetler/${e.id}/kapat`, { sekil: 'teslim' });
    expect(r.statusCode).toBe(409);
    expect(r.json().hata).toContain('stokta 7 adet var');
    expect((await eczaci('GET', '/api/emanetler?durum=acik')).json()).toHaveLength(1);

    await eczaci('POST', '/api/stok/giris', { barkod: KREM, miktar: 2, partiNo: 'C', skt: '2027-09-30', birimMaliyetKurus: 10000 });
    const t = await eczaci('POST', `/api/emanetler/${e.id}/kapat`, { sekil: 'teslim' });
    expect(t.statusCode).toBe(200);
    expect(t.json().kalemler[0].partiler).toHaveLength(3);
    expect(await stokAdedi()).toBe(0);
  });

  it('eczaneden alınan emanet stoğa girer, iade edilince çıkar; eczaneler birbirinin emanetini göremez', async () => {
    const { eczaci, app, kullanicilar, stokAdedi } = await ortam();
    const e = (
      await eczaci('POST', '/api/emanetler', {
        tur: 'eczaneden-alinan',
        kisiAd: 'Deniz Eczanesi',
        kalemler: [{ barkod: KREM, miktar: 1, partiNo: 'D1', skt: '2028-01-31' }],
      })
    ).json();
    expect(await stokAdedi()).toBe(8);
    const baska = await girisYap(app, kullanicilar.baskaEczane.eposta);
    expect((await baska('GET', '/api/emanetler')).json()).toEqual([]);
    expect((await baska('POST', `/api/emanetler/${e.id}/kapat`, { sekil: 'odeme' })).statusCode).toBe(404);
    await eczaci('POST', `/api/emanetler/${e.id}/kapat`, { sekil: 'iade' });
    expect(await stokAdedi()).toBe(7);
  });
});
