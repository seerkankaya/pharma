import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { BelgeDeposu } from '../belge-deposu.js';
import { eczaciGerekli } from '../oturum.js';
import type { StokDeposu } from '../stok/stok-deposu.js';
import { karekodAyristir, KarekodHatasi, tekilId, type Karekod } from './karekod.js';
import {
  gonderilecekMi,
  islemIstegiDogrula,
  islemUygula,
  ItsHatasi,
  sonucuIsle,
  stokKarsilastir,
  type DeaktivasyonNedeni,
  type ItsBildirimi,
  type ItsIslemTuru,
  type ItsIstemcisi,
  type KarsiTaraf,
  type TekilDurum,
  type TekilUrun,
} from './its.js';

export interface ItsDepolari {
  tekiller: BelgeDeposu<TekilUrun>;
  bildirimler: BelgeDeposu<ItsBildirimi>;
}

/** Depoya iade ve deaktivasyon kutuyu stoktan kalıcı olarak çıkardığı için yalnızca eczacı yapar. */
const ECZACI_ISLEMLERI = new Set<ItsIslemTuru>(['depo-iade', 'deaktivasyon']);

export function itsRotalari(app: FastifyInstance, d: ItsDepolari, its: ItsIstemcisi, stok: StokDeposu, bugun: () => string) {
  // Okutulan karekodu ayrıştırır ve kutunun eczanedeki durumunu verir; hiçbir şey kaydetmez.
  app.post<{ Body: { karekod?: string } }>('/api/its/karekod', async (req, reply) => {
    if (typeof req.body?.karekod !== 'string') return reply.code(400).send({ hata: 'Karekod gönderin' });
    let k: Karekod;
    try {
      k = karekodAyristir(req.body.karekod);
    } catch (e) {
      if (e instanceof KarekodHatasi) return reply.code(400).send({ hata: e.message });
      throw e;
    }
    const tekil = await d.tekiller.al(req.kullanici!.eczaneId, tekilId(k));
    return { karekod: k, durum: tekil?.durum ?? null, miadiGecmis: k.skt < bugun() };
  });

  app.get<{ Querystring: { durum?: TekilDurum; barkod?: string } }>('/api/its/tekiller', async (req) => {
    const { durum, barkod } = req.query;
    return (await d.tekiller.liste(req.kullanici!.eczaneId)).filter((t) => (!durum || t.durum === durum) && (!barkod || t.barkod === barkod));
  });

  app.post<{
    Body: { tur?: ItsIslemTuru; karekodlar?: string[]; karsiTaraf?: KarsiTaraf; neden?: DeaktivasyonNedeni; belgeNo?: string };
  }>('/api/its/islem', async (req, reply) => {
    const b = req.body ?? {};
    if (b.tur && ECZACI_ISLEMLERI.has(b.tur) && req.kullanici!.rol !== 'eczaci')
      return reply.code(403).send({ hata: 'Depoya iade ve deaktivasyonu yalnızca eczacı yapabilir' });
    const karekodlar: Karekod[] = [];
    const okunamayan: string[] = [];
    for (const [i, m] of (Array.isArray(b.karekodlar) ? b.karekodlar : []).entries()) {
      try {
        karekodlar.push(karekodAyristir(String(m)));
      } catch (e) {
        if (!(e instanceof KarekodHatasi)) throw e;
        okunamayan.push(`${i + 1}. karekod: ${e.message}`);
      }
    }
    const hatalar = [...okunamayan, ...islemIstegiDogrula(b)];
    if (hatalar.length) return reply.code(400).send({ hata: 'İşlem bilgileri geçersiz', hatalar: [...new Set(hatalar)] });

    const { eczaneId, adSoyad } = req.kullanici!;
    const bildirimId = randomUUID();
    try {
      const sonuc = await d.tekiller.degistir(eczaneId, karekodlar.map(tekilId), (mevcut) => {
        const s = islemUygula({ tur: b.tur!, karekodlar, karsiTaraf: b.karsiTaraf, neden: b.neden, belgeNo: b.belgeNo }, mevcut, {
          bildirimId,
          zaman: new Date().toISOString(),
          kaydeden: adSoyad,
          bugun: bugun(),
        });
        return { sonuc: s, yaz: s.tekiller };
      });
      // Kutu durumu ile bildirim ayrı tablolarda; bildirim kimliği kutunun hareketinde de tutulur.
      await d.bildirimler.degistir(eczaneId, [], () => ({ sonuc: null, yaz: [sonuc.bildirim] }));
      return reply.code(201).send(sonuc);
    } catch (e) {
      if (e instanceof ItsHatasi) return reply.code(409).send({ hata: e.message, hatalar: e.hatalar });
      throw e;
    }
  });

  app.get('/api/its/bildirimler', async (req) =>
    (await d.bildirimler.liste(req.kullanici!.eczaneId)).sort((a, b) => b.olusturma.localeCompare(a.olusturma)),
  );

  // Kuyruktaki bildirimleri İTS'ye gönderir. Her bildirim önce "gönderiliyor" diye işaretlenir, böylece
  // aynı anda basılan iki gönder düğmesi aynı bildirimi iki kez göndermez.
  app.post('/api/its/bildirimler/gonder', async (req) => {
    const eczaneId = req.kullanici!.eczaneId;
    const simdi = new Date();
    const adaylar = (await d.bildirimler.liste(eczaneId)).filter((b) => gonderilecekMi(b, simdi)).map((b) => b.id);
    const sayac = { gonderildi: 0, reddedildi: 0, hata: 0 };
    for (const id of adaylar) {
      const alinan = await d.bildirimler.degistir(eczaneId, [id], (m) => {
        const b = m.get(id);
        if (!b || !gonderilecekMi(b, new Date())) return { sonuc: undefined };
        const isaretli: ItsBildirimi = { ...b, durum: 'gonderiliyor', deneme: b.deneme + 1, gonderim: new Date().toISOString() };
        return { sonuc: isaretli, yaz: [isaretli] };
      });
      if (!alinan) continue;
      let yanit;
      try {
        yanit = await its.bildir(eczaneId, alinan);
      } catch (e) {
        yanit = { ulasildi: false, hata: (e as Error).message, sonuclar: [] };
      }
      const sonuc = sonucuIsle(alinan, yanit, new Date().toISOString());
      await d.bildirimler.degistir(eczaneId, [id], () => ({ sonuc: null, yaz: [sonuc] }));
      if (sonuc.durum === 'gonderildi' || sonuc.durum === 'reddedildi' || sonuc.durum === 'hata') sayac[sonuc.durum]++;
    }
    return sayac;
  });

  // Yerel kutu kayıtlarını İTS'nin eczane stoğuyla ve stok kartlarındaki adetle karşılaştırır.
  app.get('/api/its/karsilastirma', { preHandler: eczaciGerekli }, async (req, reply) => {
    const eczaneId = req.kullanici!.eczaneId;
    let itsStogu;
    try {
      itsStogu = await its.stok(eczaneId);
    } catch (e) {
      return reply.code(502).send({ hata: `İTS stoğu alınamadı: ${(e as Error).message}` });
    }
    return stokKarsilastir(await d.tekiller.liste(eczaneId), itsStogu, await stok.stok(eczaneId));
  });
}
