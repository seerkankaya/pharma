import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Ek4aListesi } from '@scalpiq/sut-motoru';
import type { CariBorc, CariDeposu } from '../cari/cari.js';
import { eczaciGerekli } from '../oturum.js';
import {
  satisHazirla,
  satisIstegiDogrula,
  StokHatasi,
  stokUyarilari,
  turkiyeGunu,
  urunDogrula,
  type Satis,
  type SatisIstegi,
  type StokHareketi,
  type Urun,
} from './stok.js';
import type { StokDeposu } from './stok-deposu.js';

const TARIH = /^\d{4}-\d{2}-\d{2}$/;

/** Türkiye saatine göre bir günün [başlangıç, bitiş) aralığı. */
function gunAraligi(gun: string) {
  const baslangic = new Date(`${gun}T00:00:00+03:00`);
  return { baslangic, bitis: new Date(baslangic.getTime() + 86_400_000) };
}

export function stokRotalari(app: FastifyInstance, depo: StokDeposu, cari: CariDeposu, ek4a: Ek4aListesi, bugun: () => string) {
  app.get('/api/urunler', async (req) => depo.urunler(req.kullanici!.eczaneId));

  // Kart yoksa EK-4/A'dan öneri döner; ekran ilacın adını buradan doldurur.
  app.get<{ Params: { barkod: string } }>('/api/urunler/:barkod', async (req, reply) => {
    const kart = (await depo.urunler(req.kullanici!.eczaneId)).find((u) => u.barkod === req.params.barkod);
    if (kart) return { kart };
    const ilac = ek4a.bul(req.params.barkod);
    if (ilac) return { oneri: { barkod: ilac.barkod, ad: ilac.ad, ilac: true, kdvOrani: 10 } };
    return reply.code(404).send({ hata: 'Bu barkodla kart da EK-4/A kaydı da yok' });
  });

  // Fiyat ve KDV'yi eczacı belirler. İlaç olup olmadığı istemciden değil EK-4/A'dan alınır.
  app.put<{ Params: { barkod: string }; Body: Partial<Urun> }>('/api/urunler/:barkod', { preHandler: eczaciGerekli }, async (req, reply) => {
    const b = req.body ?? {};
    const urun: Urun = {
      barkod: req.params.barkod,
      ad: (b.ad ?? '').trim(),
      ilac: !!ek4a.bul(req.params.barkod),
      kdvOrani: b.kdvOrani!,
      satisFiyatiKurus: b.satisFiyatiKurus!,
      ...(b.kritikStok !== undefined && b.kritikStok !== null ? { kritikStok: b.kritikStok } : {}),
    };
    const hatalar = urunDogrula(urun);
    if (hatalar.length) return reply.code(400).send({ hata: 'Ürün bilgileri geçersiz', hatalar });
    await depo.urunKaydet(req.kullanici!.eczaneId, urun);
    return urun;
  });

  app.get('/api/stok', async (req) => {
    const eczaneId = req.kullanici!.eczaneId;
    const [urunler, stok] = await Promise.all([depo.urunler(eczaneId), depo.stok(eczaneId)]);
    return urunler.map((u) => {
      const p = stok.get(u.barkod) ?? [];
      return { urun: u, miktar: p.reduce((t, x) => t + x.miktar, 0), partiler: p, uyarilar: stokUyarilari(u, p, bugun()) };
    });
  });

  app.post<{ Body: { barkod?: string; miktar?: number; partiNo?: string; skt?: string; birimMaliyetKurus?: number } }>(
    '/api/stok/giris',
    async (req, reply) => {
      const { barkod = '', miktar, partiNo = '', skt = '', birimMaliyetKurus } = req.body ?? {};
      const hatalar: string[] = [];
      if (!Number.isInteger(miktar) || miktar! < 1) hatalar.push('Miktar 1 ya da daha büyük tamsayı olmalı');
      if (!partiNo.trim()) hatalar.push('Parti numarası gerekli');
      if (!TARIH.test(skt) || Number.isNaN(Date.parse(skt))) hatalar.push('Son kullanma tarihi YYYY-AA-GG olmalı');
      else if (skt < bugun()) hatalar.push('Miadı geçmiş ürün stoğa alınamaz');
      if (birimMaliyetKurus !== undefined && (!Number.isInteger(birimMaliyetKurus) || birimMaliyetKurus < 0))
        hatalar.push('Birim maliyet kuruş cinsinden sıfır ya da pozitif tamsayı olmalı');
      const eczaneId = req.kullanici!.eczaneId;
      if (!(await depo.urunler(eczaneId)).some((u) => u.barkod === barkod)) hatalar.push('Önce bu barkod için ürün kartı açın');
      if (hatalar.length) return reply.code(400).send({ hata: 'Stok girişi geçersiz', hatalar });

      const hareket: StokHareketi = {
        barkod,
        tur: 'giris',
        miktar: miktar!,
        partiNo: partiNo.trim(),
        skt,
        birimMaliyetKurus,
        kullaniciId: req.kullanici!.id,
        zaman: new Date().toISOString(),
      };
      await depo.islem(eczaneId, [barkod], () => ({ sonuc: undefined, hareketler: [hareket] }));
      return reply.code(201).send(hareket);
    },
  );

  // Miadı geçen, kırılan ya da bozulan ürün stoktan imha kaydıyla düşülür. Gerekçe zorunludur.
  app.post<{ Body: { barkod?: string; partiNo?: string; skt?: string; miktar?: number; aciklama?: string } }>(
    '/api/stok/imha',
    { preHandler: eczaciGerekli },
    async (req, reply) => {
      const { barkod = '', partiNo = '', skt = '', miktar, aciklama = '' } = req.body ?? {};
      if (!Number.isInteger(miktar) || miktar! < 1 || aciklama.trim().length < 5)
        return reply.code(400).send({ hata: 'Miktar ve en az 5 karakterlik açıklama gerekli' });
      try {
        await depo.islem(req.kullanici!.eczaneId, [barkod], (p) => {
          const parti = (p.get(barkod) ?? []).find((x) => x.partiNo === partiNo && x.skt === skt);
          if (!parti || parti.miktar < miktar!) throw new StokHatasi(`Bu partide ${parti?.miktar ?? 0} adet var`);
          return {
            sonuc: undefined,
            hareketler: [
              { barkod, tur: 'imha', miktar: -miktar!, partiNo, skt, aciklama: aciklama.trim(), kullaniciId: req.kullanici!.id, zaman: new Date().toISOString() },
            ],
          };
        });
      } catch (e) {
        if (e instanceof StokHatasi) return reply.code(409).send({ hata: e.message });
        throw e;
      }
      return reply.code(204).send();
    },
  );

  app.post<{ Body: SatisIstegi }>('/api/satis', async (req, reply) => {
    const hatalar = satisIstegiDogrula(req.body);
    if (hatalar.length) return reply.code(400).send({ hata: 'Satış geçersiz', hatalar });
    const { eczaneId, id: kullaniciId, adSoyad } = req.kullanici!;
    const urunler = new Map((await depo.urunler(eczaneId)).map((u) => [u.barkod, u]));
    const musteri = req.body.odemeTuru === 'veresiye' ? await cari.musteriAl(eczaneId, req.body.musteriId!) : undefined;
    if (req.body.odemeTuru === 'veresiye' && !musteri) return reply.code(400).send({ hata: 'Satış geçersiz', hatalar: ['Müşteri bulunamadı'] });
    try {
      const satis = await depo.islem(
        eczaneId,
        req.body.kalemler.map((k) => k.barkod),
        (partiler) => {
          const s: Satis = {
            id: randomUUID(),
            zaman: new Date().toISOString(),
            kullaniciId,
            satan: adSoyad,
            ...(musteri ? { musteriId: musteri.id, musteriAd: musteri.adSoyad } : {}),
            ...satisHazirla(req.body, urunler, partiler, bugun()),
          };
          const cariBorc: CariBorc | undefined = musteri && {
            musteriAd: musteri.adSoyad,
            limitKurus: musteri.limitKurus,
            hareket: {
              musteriId: musteri.id,
              tur: 'borc',
              tutarKurus: s.toplamKurus,
              satisId: s.id,
              aciklama: s.kalemler.map((k) => `${k.miktar} × ${k.ad}`).join(', '),
              kullaniciId,
              kaydeden: adSoyad,
              zaman: s.zaman,
            },
          };
          const hareketler = s.kalemler.flatMap((k) =>
            k.partiler.map((p): StokHareketi => ({
              barkod: k.barkod,
              tur: 'satis',
              miktar: -p.miktar,
              partiNo: p.partiNo,
              skt: p.skt,
              satisId: s.id,
              kullaniciId,
              zaman: s.zaman,
            })),
          );
          return { sonuc: s, satis: s, hareketler, cariBorc };
        },
      );
      return reply.code(201).send(satis);
    } catch (e) {
      if (e instanceof StokHatasi) return reply.code(409).send({ hata: e.message });
      throw e;
    }
  });

  app.get<{ Querystring: { gun?: string } }>('/api/satislar', async (req, reply) => {
    const gun = req.query.gun ?? turkiyeGunu(new Date());
    if (!TARIH.test(gun)) return reply.code(400).send({ hata: 'gun YYYY-AA-GG olmalı' });
    const { baslangic, bitis } = gunAraligi(gun);
    const satislar = await depo.satislar(req.kullanici!.eczaneId, baslangic, bitis);
    const toplam = (tur?: string) => satislar.filter((s) => !tur || s.odemeTuru === tur).reduce((t, s) => t + s.toplamKurus, 0);
    return {
      gun,
      satislar,
      ozet: { adet: satislar.length, toplamKurus: toplam(), nakitKurus: toplam('nakit'), kartKurus: toplam('kart'), veresiyeKurus: toplam('veresiye') },
    };
  });
}
