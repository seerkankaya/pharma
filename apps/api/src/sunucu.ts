import { ornekEk4a, ornekGecmis, ornekIlacKurallari, ornekReceteler, varsayilanAyarlar } from '@scalpiq/sut-motoru';
import { SahteMedula } from './medula.js';
import { uygulamaOlustur } from './uygulama.js';
import { gocleriUygula, havuzOlustur } from './vt/baglanti.js';
import { PgHesapDeposu, PgKontrolDeposu, PgKuralDeposu } from './vt/pg-depolar.js';

// Veritabanı adresi DATABASE_URL ile verilir; yoksa docker-compose.yml'deki yerel PostgreSQL kullanılır.
const havuz = havuzOlustur(process.env.DATABASE_URL ?? 'postgres://scalpiq:scalpiq@127.0.0.1:5432/scalpiq');
const uygulanan = await gocleriUygula(havuz);
if (uygulanan.length) console.log(`Veritabanı güncellendi: ${uygulanan.join(', ')}`);

const kurallar = new PgKuralDeposu(havuz);
// Kitaplık boşsa örnek kurallarla başlar. Örnek kurallar ekranda "örnek kural" diye işaretlidir.
await kurallar.bossaDoldur(ornekIlacKurallari);

// Şimdilik örnek EK-4/A ile, Medula'ya gitmeden çalışır.
const app = uygulamaOlustur({
  ek4a: ornekEk4a,
  kurallar,
  kontroller: new PgKontrolDeposu(havuz),
  hesaplar: new PgHesapDeposu(havuz),
  ayarlar: varsayilanAyarlar,
  medula: new SahteMedula(),
  guvenliCerez: process.env.NODE_ENV === 'production',
  // Örnek reçeteler 20.10.2026 tarihli; demo için gün SCALPIQ_BUGUN ile sabitlenebilir.
  bugun: () => process.env.SCALPIQ_BUGUN ?? new Date().toISOString().slice(0, 10),
  ornekler: ornekReceteler.map((o) => ({
    ...o,
    gecmis: o.recete.no in ornekGecmis ? [...ornekGecmis[o.recete.no as keyof typeof ornekGecmis]] : undefined,
  })),
});

const port = Number(process.env.PORT ?? 3001);
app.listen({ port, host: '127.0.0.1' }).then(() => console.log(`ScalpIQ API http://127.0.0.1:${port}`));
