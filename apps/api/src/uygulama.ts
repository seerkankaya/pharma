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
import type { OturumKullanicisi } from './hesap.js';
import type { StokDeposu } from './stok/stok-deposu.js';
import { stokRotalari } from './stok/stok-rotalari.js';
import { alisRotalari } from './alis/alis-rotalari.js';
import type { CariDeposu } from './cari/cari.js';
import { cariRotalari } from './cari/cari-rotalari.js';
import type { GunSonuDeposu } from './rapor/rapor.js';
import { raporRotalari } from './rapor/rapor-rotalari.js';
import { BellekEk4aDeposu, DegisenEk4a, type Ek4aDeposu } from './ek4a/ek4a.js';
import { ek4aRotalari } from './ek4a/ek4a-rotalari.js';
import { bellekBelgeDepolari, type BelgeDeposuUretici } from './belge-deposu.js';
import { SahteIts, type ItsIstemcisi } from './its/its.js';
import type { KasaHareketi } from './gelir-gider/gelir-gider.js';
import type { DepoOdemesi } from './depo/depo.js';
import { itsRotalari } from './its/its-rotalari.js';
import { depoRotalari } from './depo/depo-rotalari.js';
import { emanetRotalari } from './emanet/emanet-rotalari.js';
import { gelirGiderRotalari, gunlukKasaEtkisi } from './gelir-gider/gelir-gider-rotalari.js';
import { receteSatisRotalari } from './recete-satisi/recete-satisi-rotalari.js';
import { etkilesimKurallari, etkilesimRotalari } from './etkilesim/etkilesim-rotalari.js';
import { etkilesimKontrol, type EtkilesimKurali } from './etkilesim/etkilesim.js';
import type { ReceteSatisi } from './recete-satisi/recete-satisi.js';

export interface Bagimliliklar {
  /** Kontrolde kullanılan EK-4/A. DegisenEk4a verilirse yüklenen yeni liste sunucu yeniden başlamadan geçerli olur. */
  ek4a: Ek4aListesi;
  ek4aDeposu?: Ek4aDeposu;
  kurallar: KuralDeposu;
  kontroller: KontrolDeposu;
  hesaplar: HesapDeposu;
  stok: StokDeposu;
  cari: CariDeposu;
  gunSonu: GunSonuDeposu;
  ayarlar: MotorAyarlari;
  medula: MedulaIstemcisi;
  /** Yeni modüllerin (İTS, depo ...) kayıt tabloları. Verilmezse bellekte tutulur; bellek stok deposuna da aynısı verilmeli. */
  belgeler?: BelgeDeposuUretici;
  /** Verilmezse İTS'ye gitmeyen sahte istemci kullanılır. */
  its?: ItsIstemcisi;
  /** Kontrol gününü verir (testlerde sabitlenir) */
  bugun: () => string;
  /** Oturum çerezi yalnızca HTTPS üzerinden gönderilsin mi (canlıda açık) */
  guvenliCerez?: boolean;
  ornekler?: { baslik: string; recete: Recete; gecmis?: GecmisVerilis[] }[];
}

export function uygulamaOlustur(b: Bagimliliklar) {
  const app = Fastify({ logger: false });
  const ek4a = b.ek4a instanceof DegisenEk4a ? b.ek4a : new DegisenEk4a(b.ek4a);
  const belgeler = b.belgeler ?? bellekBelgeDepolari();
  const etkilesimDeposu = belgeler<EtkilesimKurali>('etkilesim_kurali');
  const eczaneEtkilesimleri = etkilesimKurallari(etkilesimDeposu);

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
      sonuc = kontrolEt({ recete, gecmis, bugun: b.bugun(), ek4a, ilacKurallari, ayarlar: b.ayarlar });
    } catch (e) {
      return reply.code(400).send({ hata: (e as Error).message });
    }

    const kontrolId = randomUUID();
    await b.kontroller.ekle({ id: kontrolId, eczaneId: req.kullanici!.eczaneId, kullaniciId: req.kullanici!.id, recete, sonuc });
    // Etkileşimler SUT sonucuna karışmaz ve gönderimi kilitlemez; eczacının hastayı uyarması içindir.
    const klinikUyarilar = etkilesimKontrol(recete.kalemler, await eczaneEtkilesimleri(req.kullanici!.eczaneId), Array.isArray(gecmis) ? gecmis : []);
    return { kontrolId, ...sonuc, klinikUyarilar };
  });

  /** Kontrol edilmiş reçeteyi Medula'ya gönderir; tekli ve toplu gönderim aynı kuralları kullanır. */
  async function receteGonder(kullanici: OturumKullanicisi, kontrolId: unknown, gerekceler: Gerekceler = {}): Promise<{ kod: number; govde: object }> {
    const k = typeof kontrolId === 'string' ? await b.kontroller.al(kontrolId, kullanici.eczaneId) : undefined;
    if (!k) return { kod: 404, govde: { hata: 'Kontrol bulunamadı. Reçeteyi yeniden kontrol edin.' } };
    if (k.durum !== 'bekliyor') return { kod: 409, govde: { hata: 'Bu reçete zaten gönderildi.' } };

    const karar = gonderimeIzinVarMi(k.sonuc, gerekceler);
    if (!karar.izin) return { kod: 409, govde: { hata: 'Gönderim kilitli', engeller: karar.engeller } };

    if (!(await b.kontroller.gonderimiBaslat(k.id))) return { kod: 409, govde: { hata: 'Bu reçete zaten gönderildi.' } };

    let medula;
    try {
      medula = await b.medula.receteGonder(k.recete);
    } catch (e) {
      medula = { basarili: false, hata: (e as Error).message };
    }
    if (!medula.basarili) {
      await b.kontroller.gonderimiBirak(k.id);
      return { kod: 502, govde: { hata: medula.hata ?? 'Medula gönderimi başarısız' } };
    }

    const kullanilanGerekceler = Object.fromEntries(Object.entries(gerekceler).filter(([, v]) => typeof v === 'string' && v.trim()));
    await b.kontroller.gonderimiTamamla(k.id, {
      zaman: new Date().toISOString(),
      kontrolId: k.id,
      receteNo: k.recete.no,
      gonderen: kullanici.adSoyad,
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
    return { kod: 200, govde: { takipNo: medula.takipNo } };
  }

  app.post<{ Body: { kontrolId: string; gerekceler?: Gerekceler } }>('/api/gonder', async (req, reply) => {
    const { kontrolId, gerekceler } = req.body ?? {};
    const r = await receteGonder(req.kullanici!, kontrolId, gerekceler);
    return reply.code(r.kod).send(r.govde);
  });

  // Toplu reçete aktarımı: her reçete tek tek ve sırayla gönderilir; biri kilitliyse ya da Medula reddederse
  // diğerleri etkilenmez. Her reçetenin sonucu ayrı döner.
  app.post<{ Body: { gonderimler?: { kontrolId: string; gerekceler?: Gerekceler }[] } }>('/api/gonder/toplu', async (req, reply) => {
    const gonderimler = req.body?.gonderimler;
    if (!Array.isArray(gonderimler) || gonderimler.length === 0) return reply.code(400).send({ hata: 'Gönderilecek reçeteleri seçin' });
    if (gonderimler.length > 100) return reply.code(400).send({ hata: 'Bir seferde en çok 100 reçete gönderilebilir' });
    if (new Set(gonderimler.map((g) => g?.kontrolId)).size !== gonderimler.length) return reply.code(400).send({ hata: 'Aynı reçete iki kez seçilmiş' });
    const sonuclar = [];
    for (const g of gonderimler) {
      const r = await receteGonder(req.kullanici!, g?.kontrolId, g?.gerekceler);
      sonuclar.push({ kontrolId: g?.kontrolId, basarili: r.kod === 200, ...r.govde });
    }
    return { gonderilen: sonuclar.filter((x) => x.basarili).length, kalan: sonuclar.filter((x) => !x.basarili).length, sonuclar };
  });

  kuralRotalari(app, b.kurallar, b.bugun);
  stokRotalari(app, b.stok, b.cari, ek4a, b.bugun);
  cariRotalari(app, b.cari);
  alisRotalari(app, b.stok, ek4a, b.bugun);
  ek4aRotalari(app, b.ek4aDeposu ?? new BellekEk4aDeposu(), ek4a, b.bugun);
  const kasaHareketleri = belgeler<KasaHareketi>('kasa_hareketi');
  const depoOdemeleri = belgeler<DepoOdemesi>('depo_odeme');
  const receteSatislari = belgeler<ReceteSatisi>('recete_satisi');
  const gunKapaliMi = async (eczaneId: string, gun: string) => !!(await b.gunSonu.al(eczaneId, gun));
  raporRotalari(app, b.stok, b.cari, b.gunSonu, b.bugun, gunlukKasaEtkisi(kasaHareketleri, depoOdemeleri, receteSatislari));
  itsRotalari(app, { tekiller: belgeler('its_tekil'), bildirimler: belgeler('its_bildirim') }, b.its ?? new SahteIts(), b.stok, b.bugun);
  depoRotalari(app, b.stok, { iadeler: belgeler('depo_iade'), odemeler: depoOdemeleri }, b.bugun, gunKapaliMi);
  emanetRotalari(app, b.stok, b.cari, belgeler('emanet'), b.bugun);
  gelirGiderRotalari(app, kasaHareketleri, gunKapaliMi, b.bugun);
  etkilesimRotalari(app, etkilesimDeposu, b.bugun);
  receteSatisRotalari(
    app,
    { satislar: receteSatislari, icmaller: belgeler('icmal'), tahsilatlar: belgeler('kurum_tahsilat'), ayarlar: belgeler('eczane_ayar') },
    b.kontroller,
    b.stok,
    b.cari,
    gunKapaliMi,
    b.bugun,
  );

  app.get('/api/denetim', async (req) => b.kontroller.denetimKayitlari(req.kullanici!.eczaneId));

  return app;
}
