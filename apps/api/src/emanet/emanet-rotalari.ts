import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { BelgeDeposu } from '../belge-deposu.js';
import type { CariDeposu } from '../cari/cari.js';
import { StokHatasi } from '../stok/stok.js';
import type { StokDeposu } from '../stok/stok-deposu.js';
import {
  emanetAc,
  emanetDogrula,
  EmanetHatasi,
  kapanisHareketleri,
  kapatilabilirMi,
  KAPANIS_SEKILLERI,
  type Emanet,
  type EmanetDurumu,
  type EmanetIstegi,
  type EmanetKapanisi,
  type KapanisSekli,
} from './emanet.js';

export function emanetRotalari(app: FastifyInstance, stok: StokDeposu, cari: CariDeposu, emanetler: BelgeDeposu<Emanet>, bugun: () => string) {
  app.get<{ Querystring: { durum?: EmanetDurumu } }>('/api/emanetler', async (req) =>
    (await emanetler.liste(req.kullanici!.eczaneId))
      .filter((e) => !req.query.durum || e.durum === req.query.durum)
      .sort((a, b) => b.zaman.localeCompare(a.zaman)),
  );

  // Emanet belgesi ve stok hareketleri aynı işlemde yazılır.
  app.post<{ Body: EmanetIstegi }>('/api/emanetler', async (req, reply) => {
    const { eczaneId, id: kullaniciId, adSoyad } = req.kullanici!;
    const hatalar = emanetDogrula(req.body, bugun());
    if (req.body?.musteriId && !(await cari.musteriAl(eczaneId, req.body.musteriId))) hatalar.push('Müşteri bulunamadı');
    if (hatalar.length) return reply.code(400).send({ hata: 'Emanet bilgileri geçersiz', hatalar });
    const kartlar = new Map((await stok.urunler(eczaneId)).map((u) => [u.barkod, u]));
    try {
      const emanet = await stok.islem(
        eczaneId,
        req.body.kalemler.map((k) => k.barkod),
        (eldekiler) => {
          const { emanet, hareketler } = emanetAc(req.body, kartlar, eldekiler, {
            id: randomUUID(),
            kullaniciId,
            kaydeden: adSoyad,
            zaman: new Date().toISOString(),
            bugun: bugun(),
          });
          return { sonuc: emanet, hareketler, belgeler: [{ tablo: 'emanet', belge: emanet }] };
        },
      );
      return reply.code(201).send(emanet);
    } catch (e) {
      if (e instanceof EmanetHatasi || e instanceof StokHatasi) return reply.code(409).send({ hata: e.message });
      throw e;
    }
  });

  // Kapanış iki adımdır: emanet önce "kapanıyor" diye işaretlenir (aynı emanet iki kez kapanamaz),
  // sonra stok hareketleri ve kapanmış belge birlikte yazılır. Stok yetmezse işaret geri alınır.
  app.post<{ Params: { id: string }; Body: { sekil?: KapanisSekli; receteNo?: string; not?: string } }>(
    '/api/emanetler/:id/kapat',
    async (req, reply) => {
      const { eczaneId, id: kullaniciId, adSoyad } = req.kullanici!;
      const { sekil, receteNo, not } = req.body ?? {};
      const id = req.params.id;
      if (sekil === 'recete' && !receteNo?.trim()) return reply.code(400).send({ hata: 'Getirilen reçetenin numarasını girin' });
      const kapanis: EmanetKapanisi = {
        sekil: sekil!,
        ...(receteNo?.trim() ? { receteNo: receteNo.trim() } : {}),
        ...(not?.trim() ? { not: not.trim() } : {}),
        kaydeden: adSoyad,
        zaman: new Date().toISOString(),
      };

      let mevcut: Emanet;
      try {
        mevcut = await emanetler.degistir(eczaneId, [id], (m) => {
          const e = m.get(id);
          if (!e) throw new EmanetHatasi('Emanet bulunamadı');
          if (!kapatilabilirMi(e, new Date())) throw new EmanetHatasi('Bu emanet zaten kapatılmış');
          if (!KAPANIS_SEKILLERI[e.tur].includes(sekil as KapanisSekli))
            throw new EmanetHatasi(`Bu emanet ${KAPANIS_SEKILLERI[e.tur].join(' ya da ')} ile kapanır`);
          return { sonuc: e, yaz: [{ ...e, durum: 'kapaniyor', kapanis }] };
        });
      } catch (e) {
        if (e instanceof EmanetHatasi) return reply.code(e.message === 'Emanet bulunamadı' ? 404 : 409).send({ hata: e.message });
        throw e;
      }

      try {
        const kapanan = await stok.islem(
          eczaneId,
          mevcut.kalemler.map((k) => k.barkod),
          (eldekiler) => {
            const { emanet, hareketler } = kapanisHareketleri(mevcut, sekil!, eldekiler, { kullaniciId, kaydeden: adSoyad, zaman: kapanis.zaman, bugun: bugun() });
            const son: Emanet = { ...emanet, durum: 'kapandi', kapanis };
            return { sonuc: son, hareketler, belgeler: [{ tablo: 'emanet', belge: son }] };
          },
        );
        return kapanan;
      } catch (e) {
        await emanetler.degistir(eczaneId, [id], () => ({ sonuc: null, yaz: [mevcut] }));
        if (e instanceof EmanetHatasi || e instanceof StokHatasi) return reply.code(409).send({ hata: e.message });
        throw e;
      }
    },
  );
}
