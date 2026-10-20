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
import type { HesapDeposu } from './hesap.js';
import { hesapRotalari } from './hesap-rotalari.js';
import type { KontrolDeposu } from './kontrol-deposu.js';
import type { KuralDeposu } from './kural-deposu.js';
import { kuralRotalari } from './kural-rotalari.js';
import type { MedulaIstemcisi } from './medula.js';
import { oturumDenetimi } from './oturum.js';
import type { StokDeposu } from './stok/stok-deposu.js';
import { stokRotalari } from './stok/stok-rotalari.js';
import { alisRotalari } from './alis/alis-rotalari.js';
import type { CariDeposu } from './cari/cari.js';
import { cariRotalari } from './cari/cari-rotalari.js';
import type { GunSonuDeposu } from './rapor/rapor.js';
import { raporRotalari } from './rapor/rapor-rotalari.js';

export interface Bagimliliklar {
  ek4a: Ek4aListesi;
  kurallar: KuralDeposu;
  kontroller: KontrolDeposu;
  hesaplar: HesapDeposu;
  stok: StokDeposu;
  cari: CariDeposu;
  gunSonu: GunSonuDeposu;
  ayarlar: MotorAyarlari;
  medula: MedulaIstemcisi;
  /** Kontrol gününü verir (testlerde sabitlenir) */
  bugun: () => string;
  /** Oturum çerezi yalnızca HTTPS üzerinden gönderilsin mi (canlıda açık) */
  guvenliCerez?: boolean;
  ornekler?: { baslik: string; recete: Recete; gecmis?: GecmisVerilis[] }[];
}

export function uygulamaOlustur(b: Bagimliliklar) {
  const app = Fastify({ logger: false });

  oturumDenetimi(app, b.hesaplar);
  hesapRotalari(app, b.hesaplar, b.guvenliCerez ?? false);

  app.get('/api/ornekler', async () => b.ornekler ?? []);

  // Sunucunun "bugün" kabul ettiği gün; tarih alanlarının varsayılanı buradan gelir.
  app.get('/api/bugun', async () => ({ bugun: b.bugun() }));

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
    await b.kontroller.ekle({ id: kontrolId, eczaneId: req.kullanici!.eczaneId, kullaniciId: req.kullanici!.id, recete, sonuc });
    return { kontrolId, ...sonuc };
  });

  app.post<{ Body: { kontrolId: string; gerekceler?: Gerekceler } }>('/api/gonder', async (req, reply) => {
    const { kontrolId, gerekceler = {} } = req.body ?? {};
    const k = typeof kontrolId === 'string' ? await b.kontroller.al(kontrolId, req.kullanici!.eczaneId) : undefined;
    if (!k) return reply.code(404).send({ hata: 'Kontrol bulunamadı. Reçeteyi yeniden kontrol edin.' });
    if (k.durum !== 'bekliyor') return reply.code(409).send({ hata: 'Bu reçete zaten gönderildi.' });

    const karar = gonderimeIzinVarMi(k.sonuc, gerekceler);
    if (!karar.izin) return reply.code(409).send({ hata: 'Gönderim kilitli', engeller: karar.engeller });

    if (!(await b.kontroller.gonderimiBaslat(k.id))) return reply.code(409).send({ hata: 'Bu reçete zaten gönderildi.' });

    let medula;
    try {
      medula = await b.medula.receteGonder(k.recete);
    } catch (e) {
      medula = { basarili: false, hata: (e as Error).message };
    }
    if (!medula.basarili) {
      await b.kontroller.gonderimiBirak(k.id);
      return reply.code(502).send({ hata: medula.hata ?? 'Medula gönderimi başarısız' });
    }

    const kullanilanGerekceler = Object.fromEntries(Object.entries(gerekceler).filter(([, v]) => typeof v === 'string' && v.trim()));
    await b.kontroller.gonderimiTamamla(k.id, {
      zaman: new Date().toISOString(),
      kontrolId: k.id,
      receteNo: k.recete.no,
      gonderen: req.kullanici!.adSoyad,
      durum: k.sonuc.durum,
      bulgular: k.sonuc.bulgular.map(({ kuralId, seviye, mesaj, kaynaklar, barkod, ilacKuraliId }) => ({
        kuralId,
        seviye,
        mesaj,
        kaynaklar,
        barkod,
        ilacKuraliId,
      })),
      gerekceler: kullanilanGerekceler,
      ek4aYayimTarihi: k.sonuc.ek4aYayimTarihi,
      takipNo: medula.takipNo,
    });
    return { takipNo: medula.takipNo };
  });

  kuralRotalari(app, b.kurallar, b.bugun);
  stokRotalari(app, b.stok, b.cari, b.ek4a, b.bugun);
  cariRotalari(app, b.cari);
  alisRotalari(app, b.stok, b.ek4a, b.bugun);
  raporRotalari(app, b.stok, b.cari, b.gunSonu, b.bugun);

  app.get('/api/denetim', async (req) => b.kontroller.denetimKayitlari(req.kullanici!.eczaneId));

  return app;
}
