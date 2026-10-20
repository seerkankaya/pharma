import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Ek4aListesi } from '@scalpiq/sut-motoru';
import { eczaciGerekli } from '../oturum.js';
import { StokHatasi, type StokHareketi, type Urun } from '../stok/stok.js';
import type { StokDeposu } from '../stok/stok-deposu.js';
import { faturaDogrula, faturaToplamlari, kalemHesapla, siparisOnerileri, type AlisFaturasi, type AlisFaturasiIstegi, type Tedarikci } from './alis.js';

export function alisRotalari(app: FastifyInstance, depo: StokDeposu, ek4a: Ek4aListesi, bugun: () => string) {
  app.get('/api/tedarikciler', async (req) => depo.tedarikciler(req.kullanici!.eczaneId));

  app.post<{ Body: Partial<Tedarikci> }>('/api/tedarikciler', { preHandler: eczaciGerekli }, async (req, reply) => {
    const ad = req.body?.ad?.trim() ?? '';
    const vergiNo = req.body?.vergiNo?.trim() || undefined;
    const telefon = req.body?.telefon?.trim() || undefined;
    const hatalar: string[] = [];
    if (!ad) hatalar.push('Tedarikçi adı boş olamaz');
    if (vergiNo && !/^\d{10,11}$/.test(vergiNo)) hatalar.push('Vergi numarası 10 ya da 11 haneli olmalı');
    if (hatalar.length) return reply.code(400).send({ hata: 'Tedarikçi bilgileri geçersiz', hatalar });
    const eczaneId = req.kullanici!.eczaneId;
    if ((await depo.tedarikciler(eczaneId)).some((t) => t.ad.toLocaleLowerCase('tr-TR') === ad.toLocaleLowerCase('tr-TR')))
      return reply.code(409).send({ hata: `${ad} zaten kayıtlı` });
    return reply.code(201).send(await depo.tedarikciEkle(eczaneId, { ad, vergiNo, telefon }));
  });

  app.get('/api/alis-faturalari', async (req) => depo.faturalar(req.kullanici!.eczaneId));

  // Fatura ve stok girişleri tek işlemde yazılır: biri yazılamazsa hiçbiri yazılmaz.
  app.post<{ Body: AlisFaturasiIstegi }>('/api/alis-faturalari', async (req, reply) => {
    const { eczaneId, id: kullaniciId, adSoyad } = req.kullanici!;
    const kartlar = new Map((await depo.urunler(eczaneId)).map((u) => [u.barkod, u]));
    const hatalar = faturaDogrula(req.body, kartlar, bugun());
    const tedarikci = (await depo.tedarikciler(eczaneId)).find((t) => t.id === req.body?.tedarikciId);
    if (req.body?.tedarikciId && !tedarikci) hatalar.push('Tedarikçi bulunamadı');
    if (hatalar.length) return reply.code(400).send({ hata: 'Fatura geçersiz', hatalar });

    const b = req.body;
    const yeniUrunler: Urun[] = b.kalemler
      .filter((k) => !kartlar.has(k.barkod))
      .map((k) => ({ barkod: k.barkod, ad: k.ad!.trim(), ilac: !!ek4a.bul(k.barkod), kdvOrani: k.kdvOrani, satisFiyatiKurus: k.satisFiyatiKurus! }));
    const kalemler = b.kalemler.map((k) => kalemHesapla(k, kartlar.get(k.barkod)?.ad ?? k.ad!.trim()));
    const zaman = new Date().toISOString();
    const fatura: AlisFaturasi = {
      id: randomUUID(),
      tedarikciId: tedarikci!.id,
      tedarikciAd: tedarikci!.ad,
      faturaNo: b.faturaNo.trim(),
      tarih: b.tarih,
      kalemler,
      ...faturaToplamlari(kalemler),
      kaydeden: adSoyad,
      zaman,
    };
    const hareketler = kalemler.map(
      (k): StokHareketi => ({
        barkod: k.barkod,
        tur: 'giris',
        miktar: k.miktar + k.malFazlasi,
        partiNo: k.partiNo,
        skt: k.skt,
        birimMaliyetKurus: k.birimMaliyetKurus,
        faturaId: fatura.id,
        kullaniciId,
        zaman,
      }),
    );
    try {
      await depo.islem(
        eczaneId,
        kalemler.map((k) => k.barkod),
        () => ({ sonuc: undefined, fatura, yeniUrunler, hareketler }),
      );
    } catch (e) {
      if (e instanceof StokHatasi) return reply.code(409).send({ hata: e.message });
      throw e;
    }
    return reply.code(201).send(fatura);
  });

  app.get('/api/siparis-onerisi', async (req) => {
    const eczaneId = req.kullanici!.eczaneId;
    const [urunler, stok, faturalar] = await Promise.all([depo.urunler(eczaneId), depo.stok(eczaneId), depo.faturalar(eczaneId)]);
    return siparisOnerileri(urunler, stok, faturalar);
  });
}
