import { describe, expect, it } from 'vitest';
import { ornekIlacKurallari, ornekReceteler } from '@scalpiq/sut-motoru';
import { girisYap, istemci, kur, PAROLA } from './yardimci.js';

const recete = () => structuredClone(ornekReceteler.find((o) => o.recete.no === 'E-1001')!.recete);

describe('hesaplar ve oturum', () => {
  it('oturum olmadan API kapalıdır', async () => {
    const { app } = await kur();
    const r = await istemci(app)('POST', '/api/kontrol', { recete: recete() });
    expect(r.statusCode).toBe(401);
    expect((await istemci(app, 'scalpiq_oturum=uydurma')('GET', '/api/ben')).statusCode).toBe(401);
  });

  it('doğru parolayla oturum açar, çıkışta oturumu kapatır', async () => {
    const { app } = await kur();
    const giris = await app.inject({ method: 'POST', url: '/api/giris', payload: { eposta: ' Ali@Kaya.test ', parola: PAROLA } });
    expect(giris.statusCode).toBe(200);
    expect(giris.json()).toMatchObject({ adSoyad: 'Ali Tekin', eczaneAd: 'Kaya Eczanesi', rol: 'calisan' });
    expect(giris.json().parolaOzeti).toBeUndefined();
    const cerez = String(giris.headers['set-cookie']);
    expect(cerez).toContain('HttpOnly');
    expect(cerez).toContain('SameSite=Strict');

    const istek = istemci(app, cerez.split(';')[0]);
    expect((await istek('GET', '/api/ben')).statusCode).toBe(200);
    expect((await istek('POST', '/api/cikis')).statusCode).toBe(204);
    expect((await istek('GET', '/api/ben')).statusCode).toBe(401);
  });

  it('hatalı parolada ayrıntı vermez ve 5 denemeden sonra kilitler', async () => {
    const { app } = await kur();
    const dene = (eposta: string, parola: string) => app.inject({ method: 'POST', url: '/api/giris', payload: { eposta, parola } });
    expect((await dene('yok@kaya.test', 'x')).json().hata).toBe((await dene('ali@kaya.test', 'yanlis')).json().hata);
    for (let i = 0; i < 4; i++) await dene('ali@kaya.test', 'yanlis');
    expect((await dene('ali@kaya.test', PAROLA)).statusCode).toBe(429);
  });

  it('çalışan kural kitaplığını değiştiremez ve kullanıcı ekleyemez', async () => {
    const { app, kullanicilar } = await kur();
    const istek = await girisYap(app, kullanicilar.calisan.eposta);
    expect((await istek('GET', '/api/kurallar')).statusCode).toBe(200);
    expect((await istek('POST', '/api/kurallar', { id: 'X' })).statusCode).toBe(403);
    expect((await istek('GET', '/api/kullanicilar')).statusCode).toBe(403);
  });

  it('kural yetkisi olmayan eczacı kural onaylayamaz', async () => {
    const { app, kullanicilar } = await kur();
    const istek = await girisYap(app, kullanicilar.baskaEczane.eposta);
    expect((await istek('POST', '/api/kurallar/X/onayla')).statusCode).toBe(403);
  });

  it('yeni kural örnek diye işaretlenerek onaydan kaçırılamaz', async () => {
    const { app, kullanicilar } = await kur();
    const istek = await girisYap(app, kullanicilar.eczaci.eposta);
    const kural = { ...ornekIlacKurallari[0]!, id: 'KACAK' };
    expect((await istek('POST', '/api/kurallar', kural)).statusCode).toBe(201);
    const kayitli = (await istek('GET', '/api/kurallar')).json().find((k: { id: string }) => k.id === 'KACAK');
    expect(kayitli.ornek).toBeUndefined();
  });

  it('eczane başka eczanenin kontrolünü gönderemez ve denetim kaydını göremez', async () => {
    const { app, kullanicilar } = await kur(ornekIlacKurallari);
    const kaya = await girisYap(app, kullanicilar.calisan.eposta);
    const deniz = await girisYap(app, kullanicilar.baskaEczane.eposta);

    const k = (await kaya('POST', '/api/kontrol', { recete: recete() })).json();
    expect((await deniz('POST', '/api/gonder', { kontrolId: k.kontrolId })).statusCode).toBe(404);
    expect((await kaya('POST', '/api/gonder', { kontrolId: k.kontrolId })).statusCode).toBe(200);

    const [kayit] = (await kaya('GET', '/api/denetim')).json();
    expect(kayit).toMatchObject({ receteNo: 'E-1001', gonderen: 'Ali Tekin', kontrolId: k.kontrolId });
    expect((await deniz('GET', '/api/denetim')).json()).toEqual([]);
  });

  it('eczacı kendi eczanesine kullanıcı ekler; kapatılan kullanıcının oturumu düşer', async () => {
    const { app, kullanicilar } = await kur();
    const eczaci = await girisYap(app, kullanicilar.eczaci.eposta);

    const gecersiz = await eczaci('POST', '/api/kullanicilar', { eposta: 'x', adSoyad: '', rol: 'patron', parola: 'kisa' });
    expect(gecersiz.statusCode).toBe(400);
    expect(gecersiz.json().hatalar).toHaveLength(4);
    expect((await eczaci('POST', '/api/kullanicilar', { eposta: 'ALI@kaya.test', adSoyad: 'Ali', rol: 'calisan', parola: PAROLA })).statusCode).toBe(409);

    const yeni = await eczaci('POST', '/api/kullanicilar', { eposta: 'veli@kaya.test', adSoyad: 'Veli Can', rol: 'calisan', parola: PAROLA });
    expect(yeni.statusCode).toBe(201);
    expect(yeni.json()).toMatchObject({ eposta: 'veli@kaya.test', kuralYetkisi: false });
    expect(yeni.json().parolaOzeti).toBeUndefined();
    expect((await eczaci('GET', '/api/kullanicilar')).json()).toHaveLength(3);

    const veli = await girisYap(app, 'veli@kaya.test');
    expect((await eczaci('POST', `/api/kullanicilar/${yeni.json().id}/durum`, { aktif: false })).statusCode).toBe(204);
    expect((await veli('GET', '/api/ben')).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/giris', payload: { eposta: 'veli@kaya.test', parola: PAROLA } })).statusCode).toBe(401);
  });

  it('eczacı başka eczanenin kullanıcısını kapatamaz, kendini de kapatamaz', async () => {
    const { app, kullanicilar } = await kur();
    const eczaci = await girisYap(app, kullanicilar.eczaci.eposta);
    expect((await eczaci('POST', `/api/kullanicilar/${kullanicilar.baskaEczane.id}/durum`, { aktif: false })).statusCode).toBe(404);
    expect((await eczaci('POST', `/api/kullanicilar/${kullanicilar.eczaci.id}/durum`, { aktif: false })).statusCode).toBe(409);
  });

  it('aynı kontrol aynı anda iki kez gönderilemez', async () => {
    const { app, kullanicilar, medula } = await kur(ornekIlacKurallari);
    const istek = await girisYap(app, kullanicilar.calisan.eposta);
    const k = (await istek('POST', '/api/kontrol', { recete: recete() })).json();
    const sonuclar = await Promise.all([1, 2, 3].map(() => istek('POST', '/api/gonder', { kontrolId: k.kontrolId })));
    expect(sonuclar.map((r) => r.statusCode).sort()).toEqual([200, 409, 409]);
    expect(medula.gonderilenler).toHaveLength(1);
  });
});
