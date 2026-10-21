import type { FastifyInstance } from 'fastify';
import { cakisanKural, gunFarki, kuralDogrula, SUT_SURUMU, sutTaslakKurallari, type IlacKurali } from '@scalpiq/sut-motoru';
import type { KuralDeposu } from './kural-deposu.js';
import { kuralYetkisiGerekli } from './oturum.js';

// Kural kitaplığı yönetimi. Akış: taslak eklenir → eczacı SUT metniyle karşılaştırıp onaylar → kontrolde kullanılır.
// SUT değişince eski kuralın geçerliliği kapatılır ve yeni sürüm taslak olarak eklenip onaylanır.
// Onaylı kural düzenlenemez ve silinemez; böylece geçmiş kontrollerin hangi kurala dayandığı hep izlenebilir.
// Kitaplık tüm eczanelerde ortaktır; okumak herkese, değiştirmek kural yetkisi olan eczacılara açıktır.

interface Yanit {
  kod: number;
  govde?: unknown;
}

const hata = (kod: number, mesaj: string, ek: object = {}): Yanit => ({ kod, govde: { hata: mesaj, ...ek } });

/** Kuralın içeriği; kimlik, geçerlilik ve onay dışarıda bırakılır. Anahtar sırası karşılaştırmayı etkilemez. */
function icerik(k: IlacKurali): string {
  const { id: _i, gecerlilik: _g, onay: _o, ...geri } = k;
  const sirala = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(sirala)
      : v && typeof v === 'object'
        ? Object.fromEntries(
            Object.entries(v)
              .filter(([, x]) => x !== undefined)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([a, x]) => [a, sirala(x)]),
          )
        : v;
  return JSON.stringify(sirala(geri));
}

/**
 * Kitaplıktaki kuralları güncel SUT taslaklarıyla karşılaştırır:
 * - kitaplıkta olmayan taslak eklenir,
 * - onaylanmamış eski taslak güncel metinle değiştirilir,
 * - onaylı ama metni değişmiş kural için bugünden geçerli yeni sürüm taslağı açılır. Eczacı eskisini kapatıp yenisini onaylar;
 *   onaylı kural hiçbir zaman kendiliğinden değişmez.
 */
function taslakPlani(kurallar: IlacKurali[], bugun: string) {
  const kayitli = new Map(kurallar.map((k) => [k.id, k]));
  const eklenecek: IlacKurali[] = [];
  const guncellenecek: IlacKurali[] = [];
  const yeniSurum: IlacKurali[] = [];
  for (const t of sutTaslakKurallari) {
    const k = kayitli.get(t.id);
    if (!k) eklenecek.push(t);
    else if (icerik(k) === icerik(t)) continue;
    else if (!k.onay) guncellenecek.push({ ...t, gecerlilik: k.gecerlilik });
    else if (!k.gecerlilik.bitis) {
      const id = `${t.id}-${SUT_SURUMU}`;
      const surum = kayitli.get(id);
      if (!surum || (!surum.onay && icerik(surum) !== icerik(t))) yeniSurum.push({ ...t, id, gecerlilik: { baslangic: surum?.gecerlilik.baslangic ?? bugun } });
    }
  }
  return { eklenecek, guncellenecek, yeniSurum };
}

export function kuralRotalari(app: FastifyInstance, depo: KuralDeposu, bugun: () => string) {
  app.get('/api/kurallar', async () => depo.listele());

  app.post<{ Body: IlacKurali }>('/api/kurallar', { preHandler: kuralYetkisiGerekli }, async (req, reply) => {
    const { onay: _onay, ornek: _ornek, ...kural } = (req.body ?? {}) as IlacKurali;
    const hatalar = kuralDogrula(kural);
    if (hatalar.length) return reply.code(400).send({ hata: 'Kural geçersiz', hatalar });
    const y = await depo.degistir((kurallar) =>
      kurallar.some((k) => k.id === kural.id)
        ? { sonuc: hata(409, `${kural.id} kimlikli kural zaten var`) }
        : { sonuc: { kod: 201, govde: kural }, kaydet: [kural] },
    );
    return reply.code(y.kod).send(y.govde);
  });

  // Taslak, onaylanmadan önce düzeltilebilir. Onaylı ve örnek kurallar düzenlenmez.
  app.put<{ Params: { id: string }; Body: IlacKurali }>('/api/kurallar/:id', { preHandler: kuralYetkisiGerekli }, async (req, reply) => {
    const { onay: _onay, ornek: _ornek, ...kural } = { ...(req.body ?? {}), id: req.params.id } as IlacKurali;
    const hatalar = kuralDogrula(kural);
    if (hatalar.length) return reply.code(400).send({ hata: 'Kural geçersiz', hatalar });
    const y = await depo.degistir<Yanit>((kurallar) => {
      const mevcut = kurallar.find((k) => k.id === kural.id);
      if (!mevcut) return { sonuc: hata(404, 'Kural bulunamadı') };
      if (mevcut.onay || mevcut.ornek) return { sonuc: hata(409, 'Yalnızca taslak kural düzenlenebilir') };
      return { sonuc: { kod: 200, govde: kural }, kaydet: [kural] };
    });
    return reply.code(y.kod).send(y.govde);
  });

  // ScalpIQ'nun SUT'tan kodladığı taslaklar. Kitaplıkta olmayanlar eklenir; var olanlara dokunulmaz.
  app.get('/api/kurallar/sut-taslaklari', async () => {
    const p = taslakPlani(await depo.listele(), bugun());
    return {
      toplam: sutTaslakKurallari.length,
      eksik: p.eklenecek.length,
      guncellenecek: p.guncellenecek.length,
      yeniSurum: p.yeniSurum.map((k) => k.id),
    };
  });

  app.post('/api/kurallar/sut-taslaklari', { preHandler: kuralYetkisiGerekli }, async () =>
    depo.degistir((kurallar) => {
      const p = taslakPlani(kurallar, bugun());
      return {
        sonuc: { eklenen: p.eklenecek.length, guncellenen: p.guncellenecek.length, yeniSurum: p.yeniSurum.map((k) => k.id) },
        kaydet: [...p.eklenecek, ...p.guncellenecek, ...p.yeniSurum],
      };
    }),
  );

  app.post<{ Params: { id: string } }>('/api/kurallar/:id/onayla', { preHandler: kuralYetkisiGerekli }, async (req, reply) => {
    const onaylayan = req.kullanici!.adSoyad;
    const y = await depo.degistir<Yanit>((kurallar) => {
      const kural = kurallar.find((k) => k.id === req.params.id);
      if (!kural) return { sonuc: hata(404, 'Kural bulunamadı') };
      if (kural.ornek) return { sonuc: hata(409, 'Örnek kural onaylanamaz') };
      if (kural.onay) return { sonuc: hata(409, 'Kural zaten onaylı') };
      const cakisan = cakisanKural(kurallar, kural);
      if (cakisan) return { sonuc: hata(409, `${cakisan.id} kuralı aynı etken madde için aynı tarihlerde geçerli. Önce onun geçerliliğini kapatın.`) };
      const onayli = { ...kural, onay: { onaylayan, tarih: bugun() } };
      return { sonuc: { kod: 200, govde: onayli }, kaydet: [onayli] };
    });
    return reply.code(y.kod).send(y.govde);
  });

  app.post<{ Params: { id: string }; Body: { bitis?: string } }>(
    '/api/kurallar/:id/kapat',
    { preHandler: kuralYetkisiGerekli },
    async (req, reply) => {
      const bitis = req.body?.bitis ?? '';
      const y = await depo.degistir<Yanit>((kurallar) => {
        const kural = kurallar.find((k) => k.id === req.params.id);
        if (!kural) return { sonuc: hata(404, 'Kural bulunamadı') };
        if (!kural.onay) return { sonuc: hata(409, 'Taslak kural kapatılmaz, silinir') };
        if (kural.gecerlilik.bitis) return { sonuc: hata(409, 'Kuralın geçerliliği zaten kapatılmış') };
        const yeni = { ...kural, gecerlilik: { ...kural.gecerlilik, bitis } };
        const hatalar = kuralDogrula(yeni);
        if (hatalar.length) return { sonuc: hata(400, 'Geçersiz bitiş tarihi', { hatalar }) };
        if (gunFarki(bugun(), bitis) < -1)
          return { sonuc: hata(400, 'Bitiş tarihi geçmişe çekilemez; geçmiş kontroller bu kurala dayanıyor olabilir') };
        return { sonuc: { kod: 200, govde: yeni }, kaydet: [yeni] };
      });
      return reply.code(y.kod).send(y.govde);
    },
  );

  app.delete<{ Params: { id: string } }>('/api/kurallar/:id', { preHandler: kuralYetkisiGerekli }, async (req, reply) => {
    const y = await depo.degistir<Yanit>((kurallar) => {
      const kural = kurallar.find((k) => k.id === req.params.id);
      if (!kural) return { sonuc: hata(404, 'Kural bulunamadı') };
      if (kural.onay || kural.ornek) return { sonuc: hata(409, 'Onaylı kural silinemez; geçerliliğini kapatın') };
      return { sonuc: { kod: 204 }, sil: [kural.id] };
    });
    return reply.code(y.kod).send(y.govde);
  });
}
