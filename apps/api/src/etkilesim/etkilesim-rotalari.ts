import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { BelgeDeposu } from '../belge-deposu.js';
import { kuralYetkisiGerekli } from '../oturum.js';
import { etkilesimKontrol, kuralDogrula, ORNEK_ETKILESIMLER, type EtkilesimKurali } from './etkilesim.js';

/** Eczanenin geçerli etkileşim kuralları: örnek kurallar ve eczanenin eklediği kurallar. */
export const etkilesimKurallari = (depo: BelgeDeposu<EtkilesimKurali>) => async (eczaneId: string) => [
  ...ORNEK_ETKILESIMLER,
  ...(await depo.liste(eczaneId)),
];

export function etkilesimRotalari(app: FastifyInstance, depo: BelgeDeposu<EtkilesimKurali>, bugun: () => string) {
  const kurallar = etkilesimKurallari(depo);

  app.get('/api/etkilesimler', async (req) => kurallar(req.kullanici!.eczaneId));

  // Kural kitaplığı gibi: etkileşim kuralını yalnızca kural yetkisi olan eczacı ekler.
  app.post<{ Body: Partial<EtkilesimKurali> }>('/api/etkilesimler', { preHandler: kuralYetkisiGerekli }, async (req, reply) => {
    const hatalar = kuralDogrula(req.body);
    if (hatalar.length) return reply.code(400).send({ hata: 'Kural geçersiz', hatalar });
    const b = req.body as EtkilesimKurali;
    const kural: EtkilesimKurali = {
      id: randomUUID(),
      a: b.a.map((x) => x.trim()),
      b: b.b.map((x) => x.trim()),
      siddet: b.siddet,
      mesaj: b.mesaj.trim(),
      ...(b.oneri?.trim() ? { oneri: b.oneri.trim() } : {}),
      kaynak: b.kaynak.trim(),
      ekleyen: req.kullanici!.adSoyad,
      tarih: bugun(),
    };
    await depo.degistir(req.kullanici!.eczaneId, [], () => ({ sonuc: null, yaz: [kural] }));
    return reply.code(201).send(kural);
  });

  // Tezgâhta reçetesiz satışta da kullanılabilsin diye etken madde listesiyle kontrol.
  app.post<{ Body: { etkenMaddeler?: string[] } }>('/api/etkilesimler/kontrol', async (req, reply) => {
    const e = req.body?.etkenMaddeler;
    if (!Array.isArray(e) || e.length < 2 || !e.every((x) => typeof x === 'string')) return reply.code(400).send({ hata: 'En az iki etken madde gönderin' });
    return etkilesimKontrol(
      e.map((etkenMadde) => ({ etkenMadde })),
      await kurallar(req.kullanici!.eczaneId),
    );
  });
}
