import type { FastifyInstance } from 'fastify';
import { bakiye, CariHatasi, musteriDogrula, type CariDeposu, type Musteri } from './cari.js';

export function cariRotalari(app: FastifyInstance, depo: CariDeposu) {
  app.get('/api/musteriler', async (req) => depo.musteriler(req.kullanici!.eczaneId));

  // Müşteriyi kasadaki herkes açabilir; veresiye limitini yalnızca eczacı belirler.
  app.post<{ Body: Partial<Musteri> }>('/api/musteriler', async (req, reply) => {
    const m = {
      adSoyad: req.body?.adSoyad?.trim() ?? '',
      telefon: req.body?.telefon?.trim() || undefined,
      limitKurus: req.body?.limitKurus ?? undefined,
      not: req.body?.not?.trim() || undefined,
    };
    if (m.limitKurus !== undefined && req.kullanici!.rol !== 'eczaci')
      return reply.code(403).send({ hata: 'Veresiye limitini yalnızca eczacı belirleyebilir' });
    const hatalar = musteriDogrula(m);
    if (hatalar.length) return reply.code(400).send({ hata: 'Müşteri bilgileri geçersiz', hatalar });
    return reply.code(201).send(await depo.musteriEkle(req.kullanici!.eczaneId, m));
  });

  app.get<{ Params: { id: string } }>('/api/musteriler/:id', async (req, reply) => {
    const eczaneId = req.kullanici!.eczaneId;
    const musteri = await depo.musteriAl(eczaneId, req.params.id);
    if (!musteri) return reply.code(404).send({ hata: 'Müşteri bulunamadı' });
    const hareketler = await depo.hareketler(eczaneId, musteri.id);
    return { musteri, bakiyeKurus: bakiye(hareketler), hareketler };
  });

  app.post<{ Params: { id: string }; Body: { tutarKurus?: number; odemeTuru?: string; aciklama?: string } }>(
    '/api/musteriler/:id/tahsilat',
    async (req, reply) => {
      const { tutarKurus, odemeTuru, aciklama } = req.body ?? {};
      if (!Number.isInteger(tutarKurus) || tutarKurus! <= 0) return reply.code(400).send({ hata: 'Tutar pozitif olmalı' });
      if (odemeTuru !== 'nakit' && odemeTuru !== 'kart') return reply.code(400).send({ hata: 'Ödeme türü nakit ya da kart olmalı' });
      const { eczaneId, id: kullaniciId, adSoyad } = req.kullanici!;
      const musteri = await depo.musteriAl(eczaneId, req.params.id);
      if (!musteri) return reply.code(404).send({ hata: 'Müşteri bulunamadı' });
      try {
        const kalan = await depo.tahsilat(eczaneId, {
          musteriId: musteri.id,
          tur: 'tahsilat',
          tutarKurus: tutarKurus!,
          odemeTuru,
          aciklama: aciklama?.trim() || undefined,
          kullaniciId,
          kaydeden: adSoyad,
          zaman: new Date().toISOString(),
        });
        return { bakiyeKurus: kalan };
      } catch (e) {
        if (e instanceof CariHatasi) return reply.code(409).send({ hata: e.message });
        throw e;
      }
    },
  );
}
