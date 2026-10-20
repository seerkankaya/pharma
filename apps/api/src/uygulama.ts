import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import {
  etkinKurallar,
  gonderimeIzinVarMi,
  kontrolEt,
  type Ek4aListesi,
  type GecmisVerilis,
  type Gerekceler,
  type KontrolSonucu,
  type MotorAyarlari,
  type Recete,
} from '@scalpiq/sut-motoru';
import type { DenetimDeposu } from './denetim.js';
import type { KuralDeposu } from './kural-deposu.js';
import { kuralRotalari } from './kural-rotalari.js';
import type { MedulaIstemcisi } from './medula.js';

export interface Bagimliliklar {
  ek4a: Ek4aListesi;
  kurallar: KuralDeposu;
  ayarlar: MotorAyarlari;
  medula: MedulaIstemcisi;
  denetim: DenetimDeposu;
  /** Kontrol gününü verir (testlerde sabitlenir) */
  bugun: () => string;
  ornekler?: { baslik: string; recete: Recete; gecmis?: GecmisVerilis[] }[];
}

interface BekleyenKontrol {
  recete: Recete;
  sonuc: KontrolSonucu;
  gonderildi: boolean;
}

// Kontrol sonucu sunucuda tutulur; gönderim yalnızca kontrol kimliğiyle yapılır.
// Böylece istemci, kontrol edilmemiş ya da kontrolden sonra değiştirilmiş bir reçeteyi gönderemez.
const KONTROL_SINIRI = 1000;

export function uygulamaOlustur(b: Bagimliliklar) {
  const app = Fastify({ logger: false });
  const kontroller = new Map<string, BekleyenKontrol>();

  app.get('/api/ornekler', async () => b.ornekler ?? []);

  app.post<{ Body: { recete: Recete; gecmis?: GecmisVerilis[] } }>('/api/kontrol', async (req, reply) => {
    const { recete, gecmis } = req.body ?? {};
    if (!recete?.no || !Array.isArray(recete.kalemler)) return reply.code(400).send({ hata: 'Geçerli bir reçete gönderin' });

    const ilacKurallari = etkinKurallar(await b.kurallar.listele());
    let sonuc: KontrolSonucu;
    try {
      sonuc = kontrolEt({ recete, gecmis, bugun: b.bugun(), ek4a: b.ek4a, ilacKurallari, ayarlar: b.ayarlar });
    } catch (e) {
      return reply.code(400).send({ hata: (e as Error).message });
    }

    const kontrolId = randomUUID();
    kontroller.set(kontrolId, { recete: structuredClone(recete), sonuc, gonderildi: false });
    if (kontroller.size > KONTROL_SINIRI) kontroller.delete(kontroller.keys().next().value!);
    return { kontrolId, ...sonuc };
  });

  app.post<{ Body: { kontrolId: string; gerekceler?: Gerekceler } }>('/api/gonder', async (req, reply) => {
    const { kontrolId, gerekceler = {} } = req.body ?? {};
    const k = kontrolId ? kontroller.get(kontrolId) : undefined;
    if (!k) return reply.code(404).send({ hata: 'Kontrol bulunamadı. Reçeteyi yeniden kontrol edin.' });
    if (k.gonderildi) return reply.code(409).send({ hata: 'Bu reçete zaten gönderildi.' });

    const karar = gonderimeIzinVarMi(k.sonuc, gerekceler);
    if (!karar.izin) return reply.code(409).send({ hata: 'Gönderim kilitli', engeller: karar.engeller });

    const medula = await b.medula.receteGonder(k.recete);
    if (!medula.basarili) return reply.code(502).send({ hata: medula.hata ?? 'Medula gönderimi başarısız' });

    k.gonderildi = true;
    const kullanilanGerekceler = Object.fromEntries(Object.entries(gerekceler).filter(([, v]) => v.trim()));
    await b.denetim.ekle({
      zaman: new Date().toISOString(),
      receteNo: k.recete.no,
      durum: k.sonuc.durum,
      bulgular: k.sonuc.bulgular.map(({ kuralId, seviye, mesaj, kaynaklar, barkod, ilacKuraliId }) => ({ kuralId, seviye, mesaj, kaynaklar, barkod, ilacKuraliId })),
      gerekceler: kullanilanGerekceler,
      ek4aYayimTarihi: k.sonuc.ek4aYayimTarihi,
      takipNo: medula.takipNo,
    });
    return { takipNo: medula.takipNo };
  });

  kuralRotalari(app, b.kurallar, b.bugun);

  app.get('/api/denetim', async () => (await b.denetim.listele()).reverse());

  return app;
}
