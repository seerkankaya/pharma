import type { FastifyInstance } from 'fastify';
import { cakisanKural, gunFarki, kuralDogrula, type IlacKurali } from '@scalpiq/sut-motoru';
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
