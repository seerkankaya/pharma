import type { FastifyInstance } from 'fastify';
import { cakisanKural, gunFarki, kuralDogrula, type IlacKurali } from '@scalpiq/sut-motoru';
import type { KuralDeposu } from './kural-deposu.js';

// Kural kitaplığı yönetimi. Akış: taslak eklenir → eczacı SUT metniyle karşılaştırıp onaylar → kontrolde kullanılır.
// SUT değişince eski kuralın geçerliliği kapatılır ve yeni sürüm taslak olarak eklenip onaylanır.
// Onaylı kural düzenlenemez ve silinemez; böylece geçmiş kontrollerin hangi kurala dayandığı hep izlenebilir.

export function kuralRotalari(app: FastifyInstance, depo: KuralDeposu, bugun: () => string) {
  app.get('/api/kurallar', async () => depo.listele());

  app.post<{ Body: IlacKurali }>('/api/kurallar', async (req, reply) => {
    const { onay: _onay, ...kural } = (req.body ?? {}) as IlacKurali;
    const hatalar = kuralDogrula(kural);
    if (hatalar.length) return reply.code(400).send({ hata: 'Kural geçersiz', hatalar });
    const kurallar = await depo.listele();
    if (kurallar.some((k) => k.id === kural.id)) return reply.code(409).send({ hata: `${kural.id} kimlikli kural zaten var` });
    kurallar.push(kural);
    await depo.kaydet(kurallar);
    return reply.code(201).send(kural);
  });

  app.post<{ Params: { id: string }; Body: { onaylayan?: string } }>('/api/kurallar/:id/onayla', async (req, reply) => {
    const onaylayan = req.body?.onaylayan?.trim();
    if (!onaylayan) return reply.code(400).send({ hata: 'Onaylayan eczacının adı gerekli' });
    const kurallar = await depo.listele();
    const kural = kurallar.find((k) => k.id === req.params.id);
    if (!kural) return reply.code(404).send({ hata: 'Kural bulunamadı' });
    if (kural.onay) return reply.code(409).send({ hata: 'Kural zaten onaylı' });
    const cakisan = cakisanKural(kurallar, kural);
    if (cakisan)
      return reply.code(409).send({
        hata: `${cakisan.id} kuralı aynı etken madde için aynı tarihlerde geçerli. Önce onun geçerliliğini kapatın.`,
      });
    kural.onay = { onaylayan, tarih: bugun() };
    await depo.kaydet(kurallar);
    return kural;
  });

  app.post<{ Params: { id: string }; Body: { bitis?: string } }>('/api/kurallar/:id/kapat', async (req, reply) => {
    const bitis = req.body?.bitis ?? '';
    const kurallar = await depo.listele();
    const kural = kurallar.find((k) => k.id === req.params.id);
    if (!kural) return reply.code(404).send({ hata: 'Kural bulunamadı' });
    if (!kural.onay) return reply.code(409).send({ hata: 'Taslak kural kapatılmaz, silinir' });
    if (kural.gecerlilik.bitis) return reply.code(409).send({ hata: 'Kuralın geçerliliği zaten kapatılmış' });
    const yeni = { ...kural, gecerlilik: { ...kural.gecerlilik, bitis } };
    const hatalar = kuralDogrula(yeni);
    if (hatalar.length) return reply.code(400).send({ hata: 'Geçersiz bitiş tarihi', hatalar });
    if (gunFarki(bugun(), bitis) < -1)
      return reply.code(400).send({ hata: 'Bitiş tarihi geçmişe çekilemez; geçmiş kontroller bu kurala dayanıyor olabilir' });
    kural.gecerlilik.bitis = bitis;
    await depo.kaydet(kurallar);
    return kural;
  });

  app.delete<{ Params: { id: string } }>('/api/kurallar/:id', async (req, reply) => {
    const kurallar = await depo.listele();
    const kural = kurallar.find((k) => k.id === req.params.id);
    if (!kural) return reply.code(404).send({ hata: 'Kural bulunamadı' });
    if (kural.onay || kural.ornek) return reply.code(409).send({ hata: 'Onaylı kural silinemez; geçerliliğini kapatın' });
    await depo.kaydet(kurallar.filter((k) => k.id !== kural.id));
    return reply.code(204).send();
  });
}
