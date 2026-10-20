import { ornekEk4a, ornekGecmis, ornekIlacKurallari, ornekReceteler, varsayilanAyarlar } from '@scalpiq/sut-motoru';
import { DosyaDenetimDeposu } from './denetim.js';
import { SahteMedula } from './medula.js';
import { uygulamaOlustur } from './uygulama.js';

// Şimdilik örnek EK-4/A ve örnek kural kitaplığı ile, Medula'ya gitmeden çalışır.
const app = uygulamaOlustur({
  ek4a: ornekEk4a,
  ilacKurallari: ornekIlacKurallari,
  ayarlar: varsayilanAyarlar,
  medula: new SahteMedula(),
  denetim: new DosyaDenetimDeposu(new URL('../../../data/denetim.jsonl', import.meta.url).pathname),
  // Örnek reçeteler 20.10.2026 tarihli; demo için gün SCALPIQ_BUGUN ile sabitlenebilir.
  bugun: () => process.env.SCALPIQ_BUGUN ?? new Date().toISOString().slice(0, 10),
  ornekler: ornekReceteler.map((o) => ({
    ...o,
    gecmis: o.recete.no in ornekGecmis ? [...ornekGecmis[o.recete.no as keyof typeof ornekGecmis]] : undefined,
  })),
});

const port = Number(process.env.PORT ?? 3001);
app.listen({ port, host: '127.0.0.1' }).then(() => console.log(`ScalpIQ API http://127.0.0.1:${port}`));
