import { ornekEk4a, varsayilanAyarlar, type IlacKurali } from '@scalpiq/sut-motoru';
import { BellekHesapDeposu, parolaOzetle, type Rol } from '../src/hesap.js';
import { BellekKontrolDeposu } from '../src/kontrol-deposu.js';
import { BellekKuralDeposu } from '../src/kural-deposu.js';
import { SahteMedula } from '../src/medula.js';
import { uygulamaOlustur } from '../src/uygulama.js';

export const PAROLA = 'cok-gizli-parola';

type Uygulama = ReturnType<typeof uygulamaOlustur>;

/** Oturum çereziyle istek atan yardımcı. */
export function istemci(app: Uygulama, cerez?: string) {
  return (method: 'GET' | 'POST' | 'DELETE', url: string, payload?: object) =>
    app.inject({ method, url, payload, headers: cerez ? { cookie: cerez } : {} });
}

export async function girisYap(app: Uygulama, eposta: string, parola = PAROLA) {
  const r = await app.inject({ method: 'POST', url: '/api/giris', payload: { eposta, parola } });
  if (r.statusCode !== 200) throw new Error(`Giriş başarısız: ${r.body}`);
  const cerez = String(r.headers['set-cookie']).split(';')[0]!;
  return istemci(app, cerez);
}

/**
 * İki eczaneli test ortamı: Kaya Eczanesi'nde kural yetkili bir eczacı ve bir çalışan,
 * Deniz Eczanesi'nde bir eczacı.
 */
export async function kur(kurallar: IlacKurali[] = []) {
  const hesaplar = new BellekHesapDeposu();
  const medula = new SahteMedula();
  const kontroller = new BellekKontrolDeposu();
  const parolaOzeti = await parolaOzetle(PAROLA);
  const kaya = await hesaplar.eczaneEkle('Kaya Eczanesi');
  const deniz = await hesaplar.eczaneEkle('Deniz Eczanesi');
  const ekle = (eczaneId: string, eposta: string, adSoyad: string, rol: Rol, kuralYetkisi = false) =>
    hesaplar.kullaniciEkle({ eczaneId, eposta, adSoyad, rol, kuralYetkisi, parolaOzeti });
  const kullanicilar = {
    eczaci: await ekle(kaya.id, 'serkan@kaya.test', 'Ecz. Serkan Kaya', 'eczaci', true),
    calisan: await ekle(kaya.id, 'ali@kaya.test', 'Ali Tekin', 'calisan'),
    baskaEczane: await ekle(deniz.id, 'ayse@deniz.test', 'Ecz. Ayşe Deniz', 'eczaci'),
  };
  const app = uygulamaOlustur({
    ek4a: ornekEk4a,
    kurallar: new BellekKuralDeposu(kurallar),
    kontroller,
    hesaplar,
    ayarlar: varsayilanAyarlar,
    medula,
    bugun: () => '2026-10-20',
  });
  return { app, medula, kontroller, hesaplar, kullanicilar, eczaneler: { kaya, deniz } };
}
