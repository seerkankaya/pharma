import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { BelgeDeposu } from '../belge-deposu.js';
import type { DepoOdemesi } from '../depo/depo.js';
import type { ReceteSatisi } from '../recete-satisi/recete-satisi.js';
import { eczaciGerekli } from '../oturum.js';
import {
  GELIR_KATEGORILERI,
  GIDER_KATEGORILERI,
  gecerliHareketler,
  gelirGiderOzeti,
  hareketDogrula,
  kasaEtkisi,
  type KasaEtkisi,
  type KasaHareketi,
  type KasaHareketIstegi,
} from './gelir-gider.js';

const TARIH = /^\d{4}-\d{2}-\d{2}$/;

class KayitHatasi extends Error {
  constructor(
    readonly kod: number,
    mesaj: string,
  ) {
    super(mesaj);
  }
}

/** Günün gelir-gider kayıtlarının, nakit depo ödemelerinin ve reçete hasta paylarının kasaya etkisi; gün sonu bunu kullanır. */
export function gunlukKasaEtkisi(hareketler: BelgeDeposu<KasaHareketi>, depoOdemeleri: BelgeDeposu<DepoOdemesi>, receteSatislari?: BelgeDeposu<ReceteSatisi>) {
  return async (eczaneId: string, gun: string): Promise<KasaEtkisi> => {
    const [h, o, r] = await Promise.all([hareketler.liste(eczaneId), depoOdemeleri.liste(eczaneId), receteSatislari?.liste(eczaneId) ?? []]);
    const etki = kasaEtkisi(gecerliHareketler(h).filter((x) => x.tarih === gun));
    etki.nakitGiderKurus += o.filter((x) => x.tarih === gun && x.odemeTuru === 'nakit').reduce((t, x) => t + x.tutarKurus, 0);
    const hastaPayi = (tur: string) =>
      r.filter((x) => x.tarih === gun && x.durum === 'satildi' && x.hastaOdemeTuru === tur).reduce((t, x) => t + x.tutarlar.hastaPayiKurus, 0);
    return { ...etki, nakitReceteKurus: hastaPayi('nakit'), kartReceteKurus: hastaPayi('kart') };
  };
}

export function gelirGiderRotalari(
  app: FastifyInstance,
  hareketler: BelgeDeposu<KasaHareketi>,
  gunKapaliMi: (eczaneId: string, gun: string) => Promise<boolean>,
  bugun: () => string,
) {
  app.get('/api/gelir-gider/kategoriler', async () => ({ gider: GIDER_KATEGORILERI, gelir: GELIR_KATEGORILERI }));

  // Kasadan yapılan küçük giderleri çalışan da girebilir; listeyi ve dökümü eczacı görür.
  app.post<{ Body: Partial<KasaHareketIstegi> }>('/api/gelir-gider', async (req, reply) => {
    const hatalar = hareketDogrula(req.body, bugun());
    if (hatalar.length) return reply.code(400).send({ hata: 'Kayıt geçersiz', hatalar });
    const b = req.body as KasaHareketIstegi;
    const { eczaneId, id: kullaniciId, adSoyad } = req.kullanici!;
    if (b.odemeTuru !== 'havale' && (await gunKapaliMi(eczaneId, b.tarih)))
      return reply.code(409).send({ hata: `${b.tarih} günü kapatılmış; kasayı etkileyen kayıt o güne girilemez` });
    const kayit: KasaHareketi = {
      id: randomUUID(),
      tur: b.tur,
      kategori: b.kategori,
      tutarKurus: b.tutarKurus,
      odemeTuru: b.odemeTuru,
      tarih: b.tarih,
      ...(b.aciklama?.trim() ? { aciklama: b.aciklama.trim() } : {}),
      ...(b.belgeNo?.trim() ? { belgeNo: b.belgeNo.trim() } : {}),
      kullaniciId,
      kaydeden: adSoyad,
      zaman: new Date().toISOString(),
    };
    await hareketler.degistir(eczaneId, [], () => ({ sonuc: null, yaz: [kayit] }));
    return reply.code(201).send(kayit);
  });

  app.get<{ Querystring: { bas?: string; bit?: string } }>('/api/gelir-gider', { preHandler: eczaciGerekli }, async (req, reply) => {
    const { bas = bugun().slice(0, 8) + '01', bit = bugun() } = req.query;
    if (!TARIH.test(bas) || !TARIH.test(bit)) return reply.code(400).send({ hata: 'bas ve bit YYYY-AA-GG olmalı' });
    const donem = (await hareketler.liste(req.kullanici!.eczaneId))
      .filter((h) => h.tarih >= bas && h.tarih <= bit)
      .sort((a, b) => b.tarih.localeCompare(a.tarih) || b.zaman.localeCompare(a.zaman));
    return { bas, bit, kayitlar: donem, ozet: gelirGiderOzeti(donem) };
  });

  // Kayıt silinmez; iptal kaydı eklenir. Kapanmış günün kasasını değiştirecek iptal yapılmaz.
  app.post<{ Params: { id: string }; Body: { aciklama?: string } }>('/api/gelir-gider/:id/iptal', { preHandler: eczaciGerekli }, async (req, reply) => {
    const aciklama = req.body?.aciklama?.trim();
    if (!aciklama || aciklama.length < 5) return reply.code(400).send({ hata: 'İptal nedenini en az 5 karakterle yazın' });
    const { eczaneId, id: kullaniciId, adSoyad } = req.kullanici!;
    const id = req.params.id;
    const iptalId = `${id}-iptal`;
    const asil = await hareketler.al(eczaneId, id);
    if (!asil || asil.iptalEdilenId) return reply.code(404).send({ hata: 'Kayıt bulunamadı' });
    if (asil.odemeTuru !== 'havale' && (await gunKapaliMi(eczaneId, asil.tarih)))
      return reply.code(409).send({ hata: `${asil.tarih} günü kapatılmış; bu kaydı düzeltmek için bugüne ters kayıt girin` });
    try {
      const iptal = await hareketler.degistir(eczaneId, [id, iptalId], (m) => {
        if (m.has(iptalId)) throw new KayitHatasi(409, 'Bu kayıt zaten iptal edilmiş');
        const k: KasaHareketi = { ...asil, id: iptalId, iptalEdilenId: id, aciklama, kullaniciId, kaydeden: adSoyad, zaman: new Date().toISOString() };
        return { sonuc: k, yaz: [k] };
      });
      return reply.code(201).send(iptal);
    } catch (e) {
      if (e instanceof KayitHatasi) return reply.code(e.kod).send({ hata: e.message });
      throw e;
    }
  });
}
