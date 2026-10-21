import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { BelgeDeposu } from '../belge-deposu.js';
import { eczaciGerekli } from '../oturum.js';
import { StokHatasi } from '../stok/stok.js';
import type { StokDeposu } from '../stok/stok-deposu.js';
import { depoCarisi, DepoHatasi, iadeDogrula, iadeHazirla, odemeDogrula, type DepoIadeIstegi, type DepoIadesi, type DepoOdemesi } from './depo.js';
import { efaturaOku, EfaturaHatasi } from './efatura.js';

export interface DepoBelgeleri {
  iadeler: BelgeDeposu<DepoIadesi>;
  odemeler: BelgeDeposu<DepoOdemesi>;
}

export function depoRotalari(app: FastifyInstance, stok: StokDeposu, d: DepoBelgeleri, bugun: () => string) {
  // e-Fatura XML'ini alış faturası taslağına çevirir; hiçbir şey kaydetmez. e-Fatura dosyaları içlerindeki
  // gömülü görünüm şablonu yüzünden büyük olabilir.
  app.post<{ Body: { xml?: string } }>('/api/alis-faturalari/xml', { bodyLimit: 10 * 1024 * 1024 }, async (req, reply) => {
    if (typeof req.body?.xml !== 'string' || !req.body.xml.trim()) return reply.code(400).send({ hata: 'e-Fatura XML dosyasını gönderin' });
    let taslak;
    try {
      taslak = efaturaOku(req.body.xml);
    } catch (e) {
      if (e instanceof EfaturaHatasi) return reply.code(400).send({ hata: e.message });
      throw e;
    }
    const eczaneId = req.kullanici!.eczaneId;
    const [tedarikciler, urunler, faturalar] = await Promise.all([stok.tedarikciler(eczaneId), stok.urunler(eczaneId), stok.faturalar(eczaneId)]);
    const tedarikci = taslak.satici.vergiNo ? tedarikciler.find((t) => t.vergiNo === taslak.satici.vergiNo) : undefined;
    const uyarilar = [...taslak.uyarilar];
    if (!tedarikci) uyarilar.push(`${taslak.satici.ad} tedarikçi olarak kayıtlı değil; önce tedarikçiyi ekleyin`);
    else if (faturalar.some((f) => f.tedarikciId === tedarikci.id && f.faturaNo === taslak.faturaNo))
      uyarilar.push(`${taslak.faturaNo} numaralı fatura bu depodan zaten girilmiş`);
    const kartlar = new Set(urunler.map((u) => u.barkod));
    for (const k of taslak.kalemler) if (!kartlar.has(k.barkod)) uyarilar.push(`${k.ad ?? k.barkod}: ürün kartı yok, satış fiyatını girin`);
    return {
      taslak: { tedarikciId: tedarikci?.id ?? '', faturaNo: taslak.faturaNo, tarih: taslak.tarih, kalemler: taslak.kalemler },
      ...(tedarikci ? { tedarikci } : { tedarikciOnerisi: taslak.satici }),
      ettn: taslak.ettn,
      odenecekKurus: taslak.odenecekKurus,
      uyarilar,
    };
  });

  app.get('/api/depo-iadeleri', async (req) => (await d.iadeler.liste(req.kullanici!.eczaneId)).sort((a, b) => b.zaman.localeCompare(a.zaman)));

  // İade faturası ve stoktan çıkış tek işlemde yazılır.
  app.post<{ Body: DepoIadeIstegi }>('/api/depo-iadeleri', { preHandler: eczaciGerekli }, async (req, reply) => {
    const { eczaneId, id: kullaniciId, adSoyad } = req.kullanici!;
    const hatalar = iadeDogrula(req.body, bugun());
    const tedarikci = (await stok.tedarikciler(eczaneId)).find((t) => t.id === req.body?.tedarikciId);
    if (req.body?.tedarikciId && !tedarikci) hatalar.push('Depo bulunamadı');
    if (hatalar.length) return reply.code(400).send({ hata: 'İade geçersiz', hatalar });
    const b = req.body;
    if ((await d.iadeler.liste(eczaneId)).some((i) => i.tedarikciId === tedarikci!.id && i.belgeNo === b.belgeNo.trim()))
      return reply.code(409).send({ hata: `${b.belgeNo} numaralı iade bu depoya zaten girilmiş` });

    const [urunler, girisler] = await Promise.all([stok.urunler(eczaneId), stok.girisler(eczaneId)]);
    const kartlar = new Map(urunler.map((u) => [u.barkod, u]));
    try {
      const iade = await stok.islem(
        eczaneId,
        b.kalemler.map((k) => k.barkod),
        (eldekiler) => {
          const { iade, hareketler } = iadeHazirla(b, tedarikci!, kartlar, eldekiler, girisler, {
            id: randomUUID(),
            kaydeden: adSoyad,
            kullaniciId,
            zaman: new Date().toISOString(),
          });
          return { sonuc: iade, hareketler, belgeler: [{ tablo: 'depo_iade', belge: iade }] };
        },
      );
      return reply.code(201).send(iade);
    } catch (e) {
      if (e instanceof DepoHatasi || e instanceof StokHatasi) return reply.code(409).send({ hata: e.message });
      if ((e as { code?: string }).code === '23505') return reply.code(409).send({ hata: `${b.belgeNo} numaralı iade bu depoya zaten girilmiş` });
      throw e;
    }
  });

  // Her deponun bakiyesi: artı ise depoya borçluyuz.
  app.get('/api/depo-carisi', async (req) => {
    const eczaneId = req.kullanici!.eczaneId;
    const [tedarikciler, faturalar, iadeler, odemeler] = await Promise.all([
      stok.tedarikciler(eczaneId),
      stok.faturalar(eczaneId),
      d.iadeler.liste(eczaneId),
      d.odemeler.liste(eczaneId),
    ]);
    return tedarikciler.map((t) => {
      const h = depoCarisi(t.id, faturalar, iadeler, odemeler);
      return {
        tedarikci: t,
        borcKurus: h.reduce((s, x) => s + x.borcKurus, 0),
        alacakKurus: h.reduce((s, x) => s + x.alacakKurus, 0),
        bakiyeKurus: h.at(-1)?.bakiyeKurus ?? 0,
      };
    });
  });

  app.get<{ Params: { id: string } }>('/api/depo-carisi/:id', async (req, reply) => {
    const eczaneId = req.kullanici!.eczaneId;
    const tedarikci = (await stok.tedarikciler(eczaneId)).find((t) => t.id === req.params.id);
    if (!tedarikci) return reply.code(404).send({ hata: 'Depo bulunamadı' });
    const [faturalar, iadeler, odemeler] = await Promise.all([stok.faturalar(eczaneId), d.iadeler.liste(eczaneId), d.odemeler.liste(eczaneId)]);
    const hareketler = depoCarisi(tedarikci.id, faturalar, iadeler, odemeler);
    return { tedarikci, bakiyeKurus: hareketler.at(-1)?.bakiyeKurus ?? 0, hareketler };
  });

  app.post<{ Params: { id: string }; Body: Partial<DepoOdemesi> }>('/api/depo-carisi/:id/odeme', { preHandler: eczaciGerekli }, async (req, reply) => {
    const { eczaneId, adSoyad } = req.kullanici!;
    const tedarikci = (await stok.tedarikciler(eczaneId)).find((t) => t.id === req.params.id);
    if (!tedarikci) return reply.code(404).send({ hata: 'Depo bulunamadı' });
    const hatalar = odemeDogrula(req.body, bugun());
    if (hatalar.length) return reply.code(400).send({ hata: 'Ödeme geçersiz', hatalar });
    const b = req.body;
    const odeme: DepoOdemesi = {
      id: randomUUID(),
      tedarikciId: tedarikci.id,
      tutarKurus: b.tutarKurus!,
      odemeTuru: b.odemeTuru!,
      tarih: b.tarih!,
      ...(b.belgeNo?.trim() ? { belgeNo: b.belgeNo.trim() } : {}),
      ...(b.aciklama?.trim() ? { aciklama: b.aciklama.trim() } : {}),
      kaydeden: adSoyad,
      zaman: new Date().toISOString(),
    };
    await d.odemeler.degistir(eczaneId, [], () => ({ sonuc: null, yaz: [odeme] }));
    return reply.code(201).send(odeme);
  });
}
