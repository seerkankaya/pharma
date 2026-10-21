import { ornekEk4a, ornekGecmis, ornekIlacKurallari, ornekReceteler, varsayilanAyarlar } from '@scalpiq/sut-motoru';
import { SahteMedula } from './medula.js';
import { turkiyeGunu } from './stok/stok.js';
import { uygulamaOlustur } from './uygulama.js';
import { gocleriUygula, havuzOlustur } from './vt/baglanti.js';
import { PgHesapDeposu, PgKontrolDeposu, PgKuralDeposu } from './vt/pg-depolar.js';
import { PgCariDeposu } from './vt/pg-cari-deposu.js';
import { PgStokDeposu } from './vt/pg-stok-deposu.js';
import { PgGunSonuDeposu } from './vt/pg-gun-sonu-deposu.js';
import { PgEk4aDeposu } from './vt/pg-ek4a-deposu.js';
import { DegisenEk4a } from './ek4a/ek4a.js';
import { haritaListesi } from '@scalpiq/sut-motoru';

// Veritabanı adresi DATABASE_URL ile verilir; yoksa docker-compose.yml'deki yerel PostgreSQL kullanılır.
const havuz = havuzOlustur(process.env.DATABASE_URL ?? 'postgres://scalpiq:scalpiq@127.0.0.1:5432/scalpiq');
const uygulanan = await gocleriUygula(havuz);
if (uygulanan.length) console.log(`Veritabanı güncellendi: ${uygulanan.join(', ')}`);

const kurallar = new PgKuralDeposu(havuz);
// Kitaplık boşsa örnek kurallarla başlar. Örnek kurallar ekranda "örnek kural" diye işaretlidir.
await kurallar.bossaDoldur(ornekIlacKurallari);

// Yüklenmiş EK-4/A varsa en son yayımlanan kullanılır; yoksa örnek liste. Medula'ya şimdilik gidilmez.
const ek4aDeposu = new PgEk4aDeposu(havuz);
const aktifEk4a = await ek4aDeposu.aktif();
const ek4a = aktifEk4a
  ? new DegisenEk4a(haritaListesi(aktifEk4a.surum.yayimTarihi, aktifEk4a.kayitlar), aktifEk4a.kayitlar, aktifEk4a.surum)
  : new DegisenEk4a(ornekEk4a);
if (aktifEk4a) console.log(`EK-4/A: ${aktifEk4a.surum.yayimTarihi} tarihli liste, ${aktifEk4a.kayitlar.length} ilaç`);

const app = uygulamaOlustur({
  ek4a,
  ek4aDeposu,
  kurallar,
  kontroller: new PgKontrolDeposu(havuz),
  hesaplar: new PgHesapDeposu(havuz),
  stok: new PgStokDeposu(havuz),
  cari: new PgCariDeposu(havuz),
  gunSonu: new PgGunSonuDeposu(havuz),
  ayarlar: varsayilanAyarlar,
  medula: new SahteMedula(),
  guvenliCerez: process.env.NODE_ENV === 'production',
  // Örnek reçeteler 20.10.2026 tarihli; demo için gün SCALPIQ_BUGUN ile sabitlenebilir.
  bugun: () => process.env.SCALPIQ_BUGUN ?? turkiyeGunu(new Date()),
  ornekler: ornekReceteler.map((o) => ({
    ...o,
    gecmis: o.recete.no in ornekGecmis ? [...ornekGecmis[o.recete.no as keyof typeof ornekGecmis]] : undefined,
  })),
});

const port = Number(process.env.PORT ?? 3001);
app.listen({ port, host: '127.0.0.1' }).then(() => console.log(`ScalpIQ API http://127.0.0.1:${port}`));
