import type { FastifyInstance } from 'fastify';
import type { CariDeposu } from '../cari/cari.js';
import { eczaciGerekli } from '../oturum.js';
import { gunAraligi } from '../stok/stok.js';
import type { StokDeposu } from '../stok/stok-deposu.js';
import {
  GunZatenKapaliHatasi,
  kasaBeklentisi,
  partiMaliyetleri,
  satisOzeti,
  stokRaporu,
  urunSatislari,
  type GunSonu,
  type GunSonuDeposu,
} from './rapor.js';

const TARIH = /^\d{4}-\d{2}-\d{2}$/;
const gecerliTarih = (t: unknown): t is string => typeof t === 'string' && TARIH.test(t) && !Number.isNaN(Date.parse(t));
const sonrakiGun = (gun: string) => new Date(Date.parse(gun) + 86_400_000).toISOString().slice(0, 10);
const gunSayisi = (bas: string, bit: string) => Math.round((Date.parse(bit) - Date.parse(bas)) / 86_400_000) + 1;

/** Bir dönem raporu en çok bu kadar gün kapsar. */
export const EN_UZUN_DONEM = 366;

export function raporRotalari(app: FastifyInstance, stok: StokDeposu, cari: CariDeposu, gunSonu: GunSonuDeposu, bugun: () => string) {
  async function gunVerisi(eczaneId: string, gun: string) {
    const { baslangic, bitis } = gunAraligi(gun);
    const [satislar, tahsilatlar] = await Promise.all([stok.satislar(eczaneId, baslangic, bitis), cari.tahsilatlar(eczaneId, baslangic, bitis)]);
    return { satislar, tahsilatlar, kasa: kasaBeklentisi(satislar, tahsilatlar) };
  }

  // Kâr ve maliyet bilgisi içerdiği için raporları yalnızca eczacı görür.
  app.get<{ Querystring: { gun?: string } }>('/api/rapor/gun', { preHandler: eczaciGerekli }, async (req, reply) => {
    const gun = req.query.gun ?? bugun();
    if (!gecerliTarih(gun)) return reply.code(400).send({ hata: 'gun YYYY-AA-GG olmalı' });
    const eczaneId = req.kullanici!.eczaneId;
    const [{ satislar, tahsilatlar, kasa }, girisler, kapanis] = await Promise.all([
      gunVerisi(eczaneId, gun),
      stok.girisler(eczaneId),
      gunSonu.al(eczaneId, gun),
    ]);
    return {
      gun,
      ozet: satisOzeti(satislar, partiMaliyetleri(girisler)),
      kasa,
      tahsilatlar,
      urunler: urunSatislari(satislar, 10),
      kapanis: kapanis ?? null,
    };
  });

  app.get<{ Querystring: { bas?: string; bit?: string } }>('/api/rapor/donem', { preHandler: eczaciGerekli }, async (req, reply) => {
    const { bas, bit } = req.query;
    if (!gecerliTarih(bas) || !gecerliTarih(bit)) return reply.code(400).send({ hata: 'bas ve bit YYYY-AA-GG olmalı' });
    if (bit < bas) return reply.code(400).send({ hata: 'Bitiş başlangıçtan önce olamaz' });
    if (gunSayisi(bas, bit) > EN_UZUN_DONEM) return reply.code(400).send({ hata: `Dönem en çok ${EN_UZUN_DONEM} gün olabilir` });
    const eczaneId = req.kullanici!.eczaneId;
    const [satislar, girisler] = await Promise.all([
      stok.satislar(eczaneId, gunAraligi(bas).baslangic, gunAraligi(bit).bitis),
      stok.girisler(eczaneId),
    ]);
    const maliyetler = partiMaliyetleri(girisler);
    const gunler = [];
    for (let g = bas; g <= bit; g = sonrakiGun(g)) {
      const { baslangic, bitis } = gunAraligi(g);
      const o = satisOzeti(satislar.filter((s) => new Date(s.zaman) >= baslangic && new Date(s.zaman) < bitis), maliyetler);
      gunler.push({ gun: g, adet: o.adet, ciroKurus: o.ciroKurus, kdvKurus: o.kdvKurus, maliyetKurus: o.maliyetKurus, brutKarKurus: o.brutKarKurus });
    }
    return { bas, bit, toplam: satisOzeti(satislar, maliyetler), gunler, urunler: urunSatislari(satislar) };
  });

  app.get('/api/rapor/stok', { preHandler: eczaciGerekli }, async (req) => {
    const eczaneId = req.kullanici!.eczaneId;
    const [urunler, partiler, girisler] = await Promise.all([stok.urunler(eczaneId), stok.stok(eczaneId), stok.girisler(eczaneId)]);
    return stokRaporu(urunler, partiler, partiMaliyetleri(girisler), bugun());
  });

  app.get('/api/gun-sonu', { preHandler: eczaciGerekli }, async (req) => gunSonu.liste(req.kullanici!.eczaneId, 60));

  // Kasayı kim kapatırsa kapatsın sayımı kendisi girer; beklenen tutar sunucuda hesaplanır.
  // Çalışan beklenen tutarı önceden görmez (kör sayım), sonucu kapanıştan sonra görür.
  app.post<{ Body: { gun?: string; sayilanNakitKurus?: number; aciklama?: string } }>('/api/gun-sonu', async (req, reply) => {
    const { gun = bugun(), sayilanNakitKurus, aciklama } = req.body ?? {};
    const hatalar: string[] = [];
    if (!gecerliTarih(gun)) hatalar.push('Gün YYYY-AA-GG olmalı');
    else if (gun > bugun()) hatalar.push('İleri bir gün kapatılamaz');
    if (!Number.isInteger(sayilanNakitKurus) || sayilanNakitKurus! < 0) hatalar.push('Sayılan nakit kuruş cinsinden sıfır ya da pozitif tamsayı olmalı');
    if (hatalar.length) return reply.code(400).send({ hata: 'Gün sonu geçersiz', hatalar });

    const { eczaneId, id: kullaniciId, adSoyad } = req.kullanici!;
    const { satislar, kasa } = await gunVerisi(eczaneId, gun);
    const farkKurus = sayilanNakitKurus! - kasa.beklenenNakitKurus;
    const not = aciklama?.trim();
    if (farkKurus !== 0 && (!not || not.length < 5))
      return reply.code(422).send({ hata: 'Kasada fark var; kapatmak için en az 5 karakterlik açıklama yazın', farkKurus });

    const kayit: GunSonu = {
      gun,
      zaman: new Date().toISOString(),
      kullaniciId,
      kapatan: adSoyad,
      satisAdedi: satislar.length,
      ciroKurus: satislar.reduce((t, s) => t + s.toplamKurus, 0),
      veresiyeKurus: satislar.filter((s) => s.odemeTuru === 'veresiye').reduce((t, s) => t + s.toplamKurus, 0),
      kasa,
      sayilanNakitKurus: sayilanNakitKurus!,
      farkKurus,
      ...(not ? { aciklama: not } : {}),
    };
    try {
      await gunSonu.kapat(eczaneId, kayit);
    } catch (e) {
      if (e instanceof GunZatenKapaliHatasi) return reply.code(409).send({ hata: e.message });
      throw e;
    }
    return reply.code(201).send(kayit);
  });

  // Çalışan kasayı kapatmadan önce günün kapanıp kapanmadığını görebilsin (tutarlar olmadan).
  app.get<{ Querystring: { gun?: string } }>('/api/gun-sonu/durum', async (req, reply) => {
    const gun = req.query.gun ?? bugun();
    if (!gecerliTarih(gun)) return reply.code(400).send({ hata: 'gun YYYY-AA-GG olmalı' });
    const k = await gunSonu.al(req.kullanici!.eczaneId, gun);
    return { gun, kapali: !!k, ...(k ? { kapatan: k.kapatan, zaman: k.zaman } : {}) };
  });
}
