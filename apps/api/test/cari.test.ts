import { describe, expect, it } from 'vitest';
import { girisYap, kur } from './yardimci.js';

const KREM = '8690000000001';

async function ortam() {
  const o = await kur();
  const eczaci = await girisYap(o.app, o.kullanicilar.eczaci.eposta);
  const calisan = await girisYap(o.app, o.kullanicilar.calisan.eposta);
  await eczaci('PUT', `/api/urunler/${KREM}`, { ad: 'Krem', kdvOrani: 20, satisFiyatiKurus: 10000 });
  await calisan('POST', '/api/stok/giris', { barkod: KREM, miktar: 20, partiNo: 'P1', skt: '2027-06-30' });
  const ahmet = (await eczaci('POST', '/api/musteriler', { adSoyad: 'Ahmet Yılmaz', telefon: '0532 000 00 00', limitKurus: 25000 })).json();
  return { ...o, eczaci, calisan, ahmet };
}

const veresiye = (musteriId: string, miktar: number) => ({ kalemler: [{ barkod: KREM, miktar }], odemeTuru: 'veresiye', musteriId });

describe('veresiye ve cari hesap', () => {
  it('veresiye satış müşteriye borç yazar; tahsilat borcu düşer', async () => {
    const { calisan, ahmet } = await ortam();
    const s = await calisan('POST', '/api/satis', veresiye(ahmet.id, 2));
    expect(s.statusCode).toBe(201);
    expect(s.json()).toMatchObject({ odemeTuru: 'veresiye', musteriAd: 'Ahmet Yılmaz', toplamKurus: 20000 });

    let detay = (await calisan('GET', `/api/musteriler/${ahmet.id}`)).json();
    expect(detay.bakiyeKurus).toBe(20000);
    expect(detay.hareketler[0]).toMatchObject({ tur: 'borc', tutarKurus: 20000, aciklama: '2 × Krem', kaydeden: 'Ali Tekin' });

    const t = await calisan('POST', `/api/musteriler/${ahmet.id}/tahsilat`, { tutarKurus: 15000, odemeTuru: 'nakit' });
    expect(t.json()).toEqual({ bakiyeKurus: 5000 });
    expect((await calisan('GET', '/api/musteriler')).json()[0]).toMatchObject({ adSoyad: 'Ahmet Yılmaz', bakiyeKurus: 5000 });
    detay = (await calisan('GET', `/api/musteriler/${ahmet.id}`)).json();
    expect(detay.hareketler.map((h: { tur: string }) => h.tur)).toEqual(['tahsilat', 'borc']);
  });

  it('limiti aşan veresiye satış yapılmaz ve stoktan düşmez', async () => {
    const { calisan, ahmet } = await ortam();
    await calisan('POST', '/api/satis', veresiye(ahmet.id, 2));
    const r = await calisan('POST', '/api/satis', veresiye(ahmet.id, 1));
    expect(r.statusCode).toBe(409);
    expect(r.json().hata).toContain('limit aşılıyor');
    expect((await calisan('GET', '/api/stok')).json()[0].miktar).toBe(18);
    expect((await calisan('GET', `/api/musteriler/${ahmet.id}`)).json().bakiyeKurus).toBe(20000);
  });

  it('aynı anda iki veresiye satış limiti birlikte aşamaz', async () => {
    const { calisan, ahmet } = await ortam();
    const r = await Promise.all([1, 2].map(() => calisan('POST', '/api/satis', veresiye(ahmet.id, 2))));
    expect(r.map((x) => x.statusCode).sort()).toEqual([201, 409]);
  });

  it('borçtan fazla tahsilat alınamaz', async () => {
    const { calisan, ahmet } = await ortam();
    const r = await calisan('POST', `/api/musteriler/${ahmet.id}/tahsilat`, { tutarKurus: 100, odemeTuru: 'kart' });
    expect(r.statusCode).toBe(409);
  });

  it('veresiye için müşteri gerekir; başka eczanenin müşterisi kullanılamaz', async () => {
    const { app, kullanicilar, calisan, ahmet } = await ortam();
    expect((await calisan('POST', '/api/satis', { kalemler: [{ barkod: KREM, miktar: 1 }], odemeTuru: 'veresiye' })).json().hatalar).toEqual([
      'Veresiye satış için müşteri seçin',
    ]);
    const deniz = await girisYap(app, kullanicilar.baskaEczane.eposta);
    expect((await deniz('GET', `/api/musteriler/${ahmet.id}`)).statusCode).toBe(404);
    expect((await deniz('POST', '/api/satis', veresiye(ahmet.id, 1))).json().hatalar).toEqual(['Müşteri bulunamadı']);
  });

  it('limiti yalnızca eczacı belirler; çalışan limitsiz müşteri açabilir', async () => {
    const { calisan } = await ortam();
    expect((await calisan('POST', '/api/musteriler', { adSoyad: 'X', limitKurus: 1 })).statusCode).toBe(403);
    expect((await calisan('POST', '/api/musteriler', { adSoyad: 'Ayşe Kara' })).statusCode).toBe(201);
    expect((await calisan('POST', '/api/musteriler', { adSoyad: ' ', telefon: 'abc' })).json().hatalar).toHaveLength(2);
  });

  it('günlük özette veresiye ayrı görünür', async () => {
    const { calisan, ahmet } = await ortam();
    const s = (await calisan('POST', '/api/satis', veresiye(ahmet.id, 1))).json();
    const gun = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(new Date(s.zaman));
    expect((await calisan('GET', `/api/satislar?gun=${gun}`)).json().ozet).toMatchObject({ veresiyeKurus: 10000, nakitKurus: 0 });
  });
});
