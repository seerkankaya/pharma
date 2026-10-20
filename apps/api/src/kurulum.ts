import { parseArgs } from 'node:util';
import { randomBytes } from 'node:crypto';
import { parolaOzetle } from './hesap.js';
import { gocleriUygula, havuzOlustur } from './vt/baglanti.js';
import { PgHesapDeposu } from './vt/pg-depolar.js';

// Yeni eczane hesabı ve ilk eczacı kullanıcısını açar. Parola rastgele üretilir ve bir kez ekrana yazılır.
// Örnek: npm run kurulum -- --eczane "Kaya Eczanesi" --eposta serkan@ornek.com --ad "Serkan Kaya" --kural-yetkisi

const { values: a } = parseArgs({
  options: {
    eczane: { type: 'string' },
    eposta: { type: 'string' },
    ad: { type: 'string' },
    'kural-yetkisi': { type: 'boolean', default: false },
  },
});

if (!a.eczane || !a.eposta || !a.ad) {
  console.error('Kullanım: npm run kurulum -- --eczane "Eczane adı" --eposta e-posta --ad "Ad Soyad" [--kural-yetkisi]');
  process.exit(1);
}

const havuz = havuzOlustur(process.env.DATABASE_URL ?? 'postgres://scalpiq:scalpiq@127.0.0.1:5432/scalpiq');
try {
  await gocleriUygula(havuz);
  const hesaplar = new PgHesapDeposu(havuz);
  const parola = randomBytes(12).toString('base64url');
  const eczane = await hesaplar.eczaneEkle(a.eczane);
  await hesaplar.kullaniciEkle({
    eczaneId: eczane.id,
    eposta: a.eposta,
    adSoyad: a.ad,
    rol: 'eczaci',
    kuralYetkisi: a['kural-yetkisi']!,
    parolaOzeti: await parolaOzetle(parola),
  });
  console.log(`${a.eczane} açıldı.\nGiriş: ${a.eposta}\nParola: ${parola}\nBu parola bir daha gösterilmez.`);
} finally {
  await havuz.end();
}
