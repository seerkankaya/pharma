import type { FastifyInstance } from 'fastify';
import type { BelgeDeposu } from '../belge-deposu.js';
import { gunAraligi, turkiyeGunu } from '../stok/stok.js';
import type { StokDeposu } from '../stok/stok-deposu.js';
import { fisIstegi, fisOzeti, yazilabilirMi, type OkcFisi, type OkcIstemcisi } from './okc.js';

const TARIH = /^\d{4}-\d{2}-\d{2}$/;
/** Fişi en çok bu kadar gün önceki satış için kesilebilir (cihaz kapalıyken yapılan satışlar için). */
const FIS_GERIYE_GUN = 7;

class FisHatasi extends Error {
  constructor(
    readonly kod: number,
    mesaj: string,
  ) {
    super(mesaj);
  }
}

export function okcRotalari(app: FastifyInstance, stok: StokDeposu, fisler: BelgeDeposu<OkcFisi>, okc: OkcIstemcisi) {
  // Satışın fişini keser. Kartlı satışta önce POS'tan tahsilat alınır. Aynı satış için ikinci fiş kesilmez:
  // kayıt önce "yazılıyor" diye işaretlenir, cihaz yanıt verince sonucu yazılır.
  app.post<{ Params: { id: string } }>('/api/satislar/:id/fis', async (req, reply) => {
    const { eczaneId, adSoyad } = req.kullanici!;
    const id = req.params.id;
    const simdi = new Date();
    const satislar = await stok.satislar(eczaneId, new Date(simdi.getTime() - FIS_GERIYE_GUN * 86_400_000), new Date(simdi.getTime() + 60_000));
    const satis = satislar.find((s) => s.id === id);
    if (!satis) return reply.code(404).send({ hata: `Satış bulunamadı (son ${FIS_GERIYE_GUN} günün satışlarına fiş kesilebilir)` });

    let kayit: OkcFisi;
    try {
      kayit = await fisler.degistir(eczaneId, [id], (m) => {
        const once = m.get(id);
        if (!yazilabilirMi(once, new Date())) throw new FisHatasi(409, once!.durum === 'yazildi' ? `Bu satışın fişi kesilmiş (fiş no ${once!.fisNo})` : 'Fiş yazdırılıyor');
        const k: OkcFisi = {
          id,
          satisId: id,
          toplamKurus: satis.toplamKurus,
          odemeTuru: satis.odemeTuru,
          durum: 'yaziliyor',
          deneme: (once?.deneme ?? 0) + 1,
          // Kart tahsilatı alınmış ama fiş kesilememişse yeniden çekilmez.
          ...(once?.kart ? { kart: once.kart } : {}),
          kaydeden: adSoyad,
          zaman: new Date().toISOString(),
        };
        return { sonuc: k, yaz: [k] };
      });
    } catch (e) {
      if (e instanceof FisHatasi) return reply.code(e.kod).send({ hata: e.message });
      throw e;
    }

    const bitir = async (k: OkcFisi) => {
      await fisler.degistir(eczaneId, [id], () => ({ sonuc: null, yaz: [k] }));
      return k;
    };
    const hataYaz = (hata: string, kart = kayit.kart) => bitir({ ...kayit, durum: 'hata', hata, ...(kart ? { kart } : {}) });

    try {
      let kart = kayit.kart;
      if (satis.odemeTuru === 'kart' && !kart) {
        const k = await okc.kartTahsilat(eczaneId, satis.toplamKurus, id);
        if (!k.basarili || !k.onayKodu) return reply.code(502).send(await hataYaz(k.hata ?? 'Kart tahsilatı alınamadı'));
        kart = { onayKodu: k.onayKodu, ...(k.maskeliKart ? { maskeliKart: k.maskeliKart } : {}) };
      }
      const f = await okc.fisKes(eczaneId, fisIstegi(satis, kart?.onayKodu));
      if (!f.basarili) return reply.code(502).send(await hataYaz(f.hata ?? 'Fiş kesilemedi', kart));
      const { hata: _h, ...temiz } = kayit;
      return await bitir({ ...temiz, durum: 'yazildi', ...(f.fisNo ? { fisNo: f.fisNo } : {}), ...(f.zNo ? { zNo: f.zNo } : {}), ...(kart ? { kart } : {}) });
    } catch (e) {
      return reply.code(502).send(await hataYaz((e as Error).message));
    }
  });

  // Günün fişleri ve fişi kesilmemiş satışlar; kasa kapanmadan önce bakılır.
  app.get<{ Querystring: { gun?: string } }>('/api/okc/gun', async (req, reply) => {
    const gun = req.query.gun ?? turkiyeGunu(new Date());
    if (!TARIH.test(gun)) return reply.code(400).send({ hata: 'gun YYYY-AA-GG olmalı' });
    const eczaneId = req.kullanici!.eczaneId;
    const { baslangic, bitis } = gunAraligi(gun);
    const [satislar, tum] = await Promise.all([stok.satislar(eczaneId, baslangic, bitis), fisler.liste(eczaneId)]);
    const ids = new Set(satislar.map((s) => s.id));
    const gunun = tum.filter((f) => ids.has(f.satisId));
    return { gun, ...fisOzeti(satislar, gunun), fisler: gunun.sort((a, b) => b.zaman.localeCompare(a.zaman)) };
  });
}
