import { describe, expect, it } from 'vitest';
import { fefoDagit, icKdv, partiler, satisIstegiDogrula, StokHatasi, stokUyarilari, turkiyeGunu, type Urun } from '../src/stok/stok.js';
import { girisYap, kur } from './yardimci.js';

const BUGUN = '2026-10-20';
// Örnek EK-4/A listesindeki bir ilaç barkodu ve listede olmayan bir dermokozmetik barkodu
const KREM = '8690000000001';

describe('stok hesapları', () => {
  it('partileri hareketlerden toplar ve son kullanma tarihine göre sıralar', () => {
    const p = partiler([
      { partiNo: 'B', skt: '2027-05-01', miktar: 10 },
      { partiNo: 'A', skt: '2026-12-01', miktar: 5 },
      { partiNo: 'B', skt: '2027-05-01', miktar: -4 },
      { partiNo: 'C', skt: '2027-01-01', miktar: 3 },
      { partiNo: 'C', skt: '2027-01-01', miktar: -3 },
    ]);
    expect(p).toEqual([
      { partiNo: 'A', skt: '2026-12-01', miktar: 5 },
      { partiNo: 'B', skt: '2027-05-01', miktar: 6 },
    ]);
  });

  it('FEFO: önce miadı en yakın partiden düşer, miadı geçmişi atlar', () => {
    const eldekiler = [
      { partiNo: 'ESKI', skt: '2026-10-19', miktar: 10 },
      { partiNo: 'A', skt: '2026-10-20', miktar: 2 },
      { partiNo: 'B', skt: '2027-01-01', miktar: 5 },
    ];
    expect(fefoDagit(eldekiler, 4, BUGUN, 'X')).toEqual([
      { partiNo: 'A', skt: '2026-10-20', miktar: 2 },
      { partiNo: 'B', skt: '2027-01-01', miktar: 2 },
    ]);
    expect(() => fefoDagit(eldekiler, 8, BUGUN, 'X')).toThrow(StokHatasi);
    expect(() => fefoDagit(eldekiler, 8, BUGUN, 'X')).toThrow('miadı geçmiş partiler satılamaz');
  });

  it('Türkiye gününü UTC’den doğru çevirir', () => {
    expect(turkiyeGunu(new Date('2026-10-20T21:30:00Z'))).toBe('2026-10-21');
    expect(turkiyeGunu(new Date('2026-10-20T20:59:00Z'))).toBe('2026-10-20');
  });

  it('KDV dahil fiyattan iç KDV hesaplar', () => {
    expect(icKdv(11000, 10)).toBe(1000);
    expect(icKdv(12000, 20)).toBe(2000);
    expect(icKdv(5000, 0)).toBe(0);
  });

  it('miadı geçmiş, yakın ve kritik stok uyarıları', () => {
    const urun: Urun = { barkod: KREM, ad: 'Krem', ilac: false, kdvOrani: 20, satisFiyatiKurus: 100, kritikStok: 10 };
    const u = stokUyarilari(urun, [
      { partiNo: 'A', skt: '2026-10-01', miktar: 1 },
      { partiNo: 'B', skt: '2026-12-01', miktar: 2 },
      { partiNo: 'C', skt: '2028-01-01', miktar: 3 },
    ], BUGUN);
    expect(u.map((x) => x.tur)).toEqual(['miadi-gecmis', 'miadi-yakin', 'kritik-stok']);
  });

  it('satış isteğini doğrular', () => {
    expect(satisIstegiDogrula({ kalemler: [], odemeTuru: 'nakit' })).toEqual(['Sepet boş']);
    expect(satisIstegiDogrula({ kalemler: [{ barkod: 'x', miktar: 1.5 }], odemeTuru: 'cek' as 'nakit' })).toHaveLength(2);
    expect(satisIstegiDogrula({ kalemler: [{ barkod: 'x', miktar: 1 }, { barkod: 'x', miktar: 2 }], odemeTuru: 'kart' })).toHaveLength(1);
  });
});

async function stokluOrtam() {
  const o = await kur();
  const eczaci = await girisYap(o.app, o.kullanicilar.eczaci.eposta);
  const calisan = await girisYap(o.app, o.kullanicilar.calisan.eposta);
  await eczaci('PUT', `/api/urunler/${KREM}`, { ad: 'Nemlendirici Krem', kdvOrani: 20, satisFiyatiKurus: 25000, kritikStok: 3 });
  await calisan('POST', '/api/stok/giris', { barkod: KREM, miktar: 2, partiNo: 'P1', skt: '2026-11-30', birimMaliyetKurus: 15000 });
  await calisan('POST', '/api/stok/giris', { barkod: KREM, miktar: 5, partiNo: 'P2', skt: '2027-06-30', birimMaliyetKurus: 15000 });
  return { ...o, eczaci, calisan };
}

describe('stok ve satış API', () => {
  it('ürün kartını yalnızca eczacı açar; ilaç bilgisi EK-4/A’dan gelir', async () => {
    const { app, kullanicilar } = await kur();
    const calisan = await girisYap(app, kullanicilar.calisan.eposta);
    const eczaci = await girisYap(app, kullanicilar.eczaci.eposta);
    expect((await calisan('PUT', `/api/urunler/${KREM}`, { ad: 'K', kdvOrani: 20, satisFiyatiKurus: 1 })).statusCode).toBe(403);
    const r = await eczaci('PUT', `/api/urunler/${KREM}`, { ad: 'K', kdvOrani: 20, satisFiyatiKurus: 1, ilac: true });
    expect(r.json().ilac).toBe(false);
    const gecersiz = await eczaci('PUT', '/api/urunler/12', { ad: '', kdvOrani: 18, satisFiyatiKurus: -1 });
    expect(gecersiz.json().hatalar).toHaveLength(4);
    expect((await eczaci('GET', '/api/urunler/0000000000000')).statusCode).toBe(404);
  });

  it('kartı olmayan ürün ve miadı geçmiş parti stoğa alınamaz', async () => {
    const { app, kullanicilar } = await kur();
    const calisan = await girisYap(app, kullanicilar.calisan.eposta);
    const r = await calisan('POST', '/api/stok/giris', { barkod: KREM, miktar: 1, partiNo: 'P', skt: '2026-10-19' });
    expect(r.json().hatalar).toEqual(['Miadı geçmiş ürün stoğa alınamaz', 'Önce bu barkod için ürün kartı açın']);
  });

  it('satış FEFO ile partilerden düşer, fiyatı karttan alır, günlük özete girer', async () => {
    const { calisan } = await stokluOrtam();
    const s = await calisan('POST', '/api/satis', { kalemler: [{ barkod: KREM, miktar: 3, birimFiyatKurus: 1 }], odemeTuru: 'kart' });
    expect(s.statusCode).toBe(201);
    expect(s.json()).toMatchObject({ toplamKurus: 75000, kdvKurus: 12500, satan: 'Ali Tekin' });
    expect(s.json().kalemler[0].partiler).toEqual([
      { partiNo: 'P1', skt: '2026-11-30', miktar: 2 },
      { partiNo: 'P2', skt: '2027-06-30', miktar: 1 },
    ]);

    const [kalem] = (await calisan('GET', '/api/stok')).json();
    expect(kalem.miktar).toBe(4);
    expect(kalem.partiler).toEqual([{ partiNo: 'P2', skt: '2027-06-30', miktar: 4 }]);

    const gun = (await calisan('GET', `/api/satislar?gun=${turkiyeGunu(new Date(s.json().zaman))}`)).json();
    expect(gun.ozet).toEqual({ adet: 1, toplamKurus: 75000, nakitKurus: 0, kartKurus: 75000 });
  });

  it('stokta olmayan miktar satılamaz ve hiçbir şey yazılmaz', async () => {
    const { calisan } = await stokluOrtam();
    const r = await calisan('POST', '/api/satis', { kalemler: [{ barkod: KREM, miktar: 8 }], odemeTuru: 'nakit' });
    expect(r.statusCode).toBe(409);
    expect(r.json().hata).toContain('stokta 7 adet var');
    expect((await calisan('GET', '/api/stok')).json()[0].miktar).toBe(7);
    expect((await calisan('GET', '/api/satislar')).json().ozet.adet).toBe(0);
  });

  it('aynı anda iki satış son kutuları birlikte satamaz', async () => {
    const { calisan } = await stokluOrtam();
    const sonuclar = await Promise.all(
      [1, 2].map(() => calisan('POST', '/api/satis', { kalemler: [{ barkod: KREM, miktar: 5 }], odemeTuru: 'nakit' })),
    );
    expect(sonuclar.map((r) => r.statusCode).sort()).toEqual([201, 409]);
  });

  it('imha yalnızca eczacıyla ve açıklamayla yapılır', async () => {
    const { eczaci, calisan } = await stokluOrtam();
    const imha = { barkod: KREM, partiNo: 'P1', skt: '2026-11-30', miktar: 1, aciklama: 'Kutu ezik geldi' };
    expect((await calisan('POST', '/api/stok/imha', imha)).statusCode).toBe(403);
    expect((await eczaci('POST', '/api/stok/imha', { ...imha, aciklama: '' })).statusCode).toBe(400);
    expect((await eczaci('POST', '/api/stok/imha', { ...imha, miktar: 3 })).statusCode).toBe(409);
    expect((await eczaci('POST', '/api/stok/imha', imha)).statusCode).toBe(204);
    expect((await eczaci('GET', '/api/stok')).json()[0].miktar).toBe(6);
  });

  it('eczaneler birbirinin stoğunu ve satışını görmez', async () => {
    const { app, kullanicilar } = await stokluOrtam();
    const deniz = await girisYap(app, kullanicilar.baskaEczane.eposta);
    expect((await deniz('GET', '/api/stok')).json()).toEqual([]);
    const r = await deniz('POST', '/api/satis', { kalemler: [{ barkod: KREM, miktar: 1 }], odemeTuru: 'nakit' });
    expect(r.statusCode).toBe(409);
  });
});
