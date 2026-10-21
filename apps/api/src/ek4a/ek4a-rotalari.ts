import type { FastifyInstance } from 'fastify';
import { ek4aOku } from '@scalpiq/ek4a-aktarim';
import { kuralYetkisiGerekli } from '../oturum.js';
import { tekillestir, type DegisenEk4a, type Ek4aDeposu } from './ek4a.js';

const TARIH = /^\d{4}-\d{2}-\d{2}$/;
/** EK-4/A Excel dosyası birkaç MB'dır; daha büyüğü yanlış dosyadır. */
const AZAMI_BOYUT = 30 * 1024 * 1024;
/** Yeni liste eskisinin bu oranından kısaysa yanlış dosya ya da eksik sayfa olabilir; onay istenir. */
const KUCULME_SINIRI = 0.5;

export function ek4aRotalari(app: FastifyInstance, depo: Ek4aDeposu, liste: DegisenEk4a, bugun: () => string) {
  // Excel dosyası gövdede ham olarak gelir.
  for (const tur of ['application/octet-stream', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel'])
    app.addContentTypeParser(tur, { parseAs: 'buffer', bodyLimit: AZAMI_BOYUT }, (_req, govde, bitti) => bitti(null, govde));

  app.get('/api/ek4a', async () => ({
    aktif: {
      yayimTarihi: liste.yayimTarihi,
      kayitSayisi: liste.surum ? liste.kayitSayisi : undefined,
      yukleyen: liste.surum?.yukleyen,
      zaman: liste.surum?.zaman,
      ornek: !liste.surum,
    },
    surumler: await depo.surumler(),
  }));

  app.get<{ Querystring: { q?: string } }>('/api/ek4a/ara', async (req) => liste.ara(req.query.q ?? ''));

  // Liste tüm eczanelerde ortak olduğu için yalnızca kural yetkisi olan eczacı yükler.
  app.post<{ Querystring: { yayimTarihi?: string; dosyaAdi?: string; zorla?: string } }>(
    '/api/ek4a',
    { preHandler: kuralYetkisiGerekli, bodyLimit: AZAMI_BOYUT },
    async (req, reply) => {
      const { yayimTarihi = '', dosyaAdi, zorla } = req.query;
      if (!TARIH.test(yayimTarihi) || Number.isNaN(Date.parse(yayimTarihi)))
        return reply.code(400).send({ hata: 'Listenin yayım tarihini YYYY-AA-GG biçiminde girin' });
      if (yayimTarihi > bugun()) return reply.code(400).send({ hata: 'Yayım tarihi ileri bir gün olamaz' });
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) return reply.code(400).send({ hata: 'Excel dosyası gönderin' });

      let okunan;
      try {
        okunan = ek4aOku(new Uint8Array(req.body));
      } catch (e) {
        return reply.code(400).send({ hata: `Dosya okunamadı: ${(e as Error).message}` });
      }
      const { kayitlar, tekrarlar } = tekillestir(
        okunan.kayitlar.map(({ barkod, ad, kamuNo, esdegerGrubu, eskiBarkodlar, pasifAraliklari }) => ({
          barkod,
          ad,
          eskiBarkodlar,
          ...(kamuNo ? { kamuNo } : {}),
          ...(esdegerGrubu ? { esdegerGrubu } : {}),
          ...(pasifAraliklari?.length ? { pasifAraliklari } : {}),
        })),
      );
      if (kayitlar.length === 0) return reply.code(400).send({ hata: 'Dosyada geçerli barkodlu ilaç bulunamadı', uyarilar: okunan.uyarilar.slice(0, 20) });

      if (liste.surum) {
        if (yayimTarihi < liste.surum.yayimTarihi)
          return reply.code(409).send({ hata: `Kullanılan liste ${liste.surum.yayimTarihi} tarihli; daha eski bir liste yüklenemez` });
        if (kayitlar.length < liste.kayitSayisi * KUCULME_SINIRI && zorla !== '1')
          return reply.code(409).send({
            hata: `Yeni listede ${kayitlar.length} ilaç var, kullanılan listede ${liste.kayitSayisi}. Yanlış dosya olabilir; doğruysa yeniden onaylayarak yükleyin.`,
            onayGerekli: true,
          });
      }

      const surum = await depo.ekle(
        { yayimTarihi, dosyaAdi: dosyaAdi?.slice(0, 200), yukleyen: req.kullanici!.adSoyad, kullaniciId: req.kullanici!.id },
        kayitlar,
      );
      liste.degistir(surum, kayitlar);
      return reply.code(201).send({
        surum,
        sayfa: okunan.sayfa,
        uyarilar: [...okunan.uyarilar, ...(tekrarlar.length ? [`${tekrarlar.length} barkod dosyada birden çok kez geçiyor; ilki alındı`] : [])].slice(0, 50),
        uyariSayisi: okunan.uyarilar.length + (tekrarlar.length ? 1 : 0),
      });
    },
  );
}
