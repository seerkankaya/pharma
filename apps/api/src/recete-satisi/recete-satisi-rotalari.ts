import type { FastifyInstance, FastifyReply } from 'fastify';
import { randomUUID } from 'node:crypto';
import type { BelgeDeposu } from '../belge-deposu.js';
import type { CariBorc, CariDeposu } from '../cari/cari.js';
import type { KontrolDeposu } from '../kontrol-deposu.js';
import { eczaciGerekli } from '../oturum.js';
import { StokHatasi } from '../stok/stok.js';
import type { StokDeposu } from '../stok/stok-deposu.js';
import {
  ayarDogrula,
  donemi,
  icmalHazirla,
  kalemleriHazirla,
  KURUM,
  kurumCarisi,
  ReceteSatisHatasi,
  stokHareketleri,
  takiliMi,
  tutarHesapla,
  type ElleTutarlar,
  type HastaOdemeTuru,
  type Icmal,
  type KatilimAyarlari,
  type KurumTahsilati,
  type ReceteSatisi,
} from './recete-satisi.js';

export interface ReceteSatisDepolari {
  satislar: BelgeDeposu<ReceteSatisi>;
  icmaller: BelgeDeposu<Icmal>;
  tahsilatlar: BelgeDeposu<KurumTahsilati>;
  ayarlar: BelgeDeposu<KatilimAyarlari & { id: string }>;
}

interface SatisIstegi {
  kontrolId?: string;
  hastaOdemeTuru?: HastaOdemeTuru;
  musteriId?: string;
  tutarlar?: ElleTutarlar;
  muaf?: boolean;
  /** Barkoda göre SGK'nın ödeyeceği kutu bedeli (kuruş); verilmeyende perakende fiyat kabul edilir */
  kamuBedelleri?: Record<string, number>;
}

const AYAR_ID = 'katilim-payi';
const TARIH = /^\d{4}-\d{2}-\d{2}$/;
const DONEM = /^\d{4}-(0[1-9]|1[0-2])$/;
const tamsayiMi = (x: unknown) => Number.isInteger(x) && (x as number) >= 0;

function hata(reply: FastifyReply, e: unknown) {
  if (e instanceof ReceteSatisHatasi) return reply.code(e.kod).send({ hata: e.message });
  if (e instanceof StokHatasi) return reply.code(409).send({ hata: e.message });
  throw e;
}

function istegiDogrula(b: SatisIstegi): string[] {
  const h: string[] = [];
  if (!b.kontrolId) h.push('Kontrol edilmiş ve Medula’ya gönderilmiş reçeteyi seçin');
  if (b.tutarlar !== undefined)
    for (const [a, v] of Object.entries(b.tutarlar)) if (v !== undefined && !tamsayiMi(v)) h.push(`${a} kuruş cinsinden sıfır ya da pozitif tamsayı olmalı`);
  if (b.kamuBedelleri !== undefined)
    for (const [barkod, v] of Object.entries(b.kamuBedelleri)) if (!tamsayiMi(v)) h.push(`${barkod} için kamu bedeli kuruş cinsinden tamsayı olmalı`);
  return h;
}

export function receteSatisRotalari(
  app: FastifyInstance,
  d: ReceteSatisDepolari,
  kontroller: KontrolDeposu,
  stok: StokDeposu,
  cari: CariDeposu,
  gunKapaliMi: (eczaneId: string, gun: string) => Promise<boolean>,
  bugun: () => string,
) {
  app.get('/api/recete-satislari/katilim-ayarlari', async (req) => (await d.ayarlar.al(req.kullanici!.eczaneId, AYAR_ID)) ?? null);

  // SUT'taki güncel katılım payı tutarlarını eczacı girer; kayıt kimin hangi gün onayladığını tutar.
  app.put<{ Body: Partial<KatilimAyarlari> }>('/api/recete-satislari/katilim-ayarlari', { preHandler: eczaciGerekli }, async (req, reply) => {
    const hatalar = ayarDogrula(req.body);
    if (hatalar.length) return reply.code(400).send({ hata: 'Ayarlar geçersiz', hatalar });
    const b = req.body as KatilimAyarlari;
    const ayar = {
      id: AYAR_ID,
      ilacKatilimYuzde: b.ilacKatilimYuzde,
      receteKatilim: { ilkKutuSayisi: b.receteKatilim.ilkKutuSayisi, ilkKutularKurus: b.receteKatilim.ilkKutularKurus, sonrakiKutuKurus: b.receteKatilim.sonrakiKutuKurus },
      muayeneKurus: b.muayeneKurus,
      onaylayan: req.kullanici!.adSoyad,
      tarih: bugun(),
    };
    await d.ayarlar.degistir(req.kullanici!.eczaneId, [AYAR_ID], () => ({ sonuc: null, yaz: [ayar] }));
    return ayar;
  });

  async function hazirla(eczaneId: string, b: SatisIstegi) {
    const k = await kontroller.al(b.kontrolId!, eczaneId);
    if (!k) throw new ReceteSatisHatasi('Kontrol bulunamadı', 404);
    if (k.durum !== 'gonderildi') throw new ReceteSatisHatasi('Reçete henüz Medula’ya gönderilmemiş; önce gönderin');
    const [urunler, ayar] = await Promise.all([stok.urunler(eczaneId), d.ayarlar.al(eczaneId, AYAR_ID)]);
    return { k, kartlar: new Map(urunler.map((u) => [u.barkod, u])), ayar };
  }

  // Satmadan önce hasta payını gösterir; hiçbir şey kaydetmez.
  app.post<{ Body: SatisIstegi }>('/api/recete-satislari/hesapla', async (req, reply) => {
    const b = req.body ?? {};
    const hatalar = istegiDogrula(b);
    if (hatalar.length) return reply.code(400).send({ hata: 'İstek geçersiz', hatalar });
    try {
      const eczaneId = req.kullanici!.eczaneId;
      const { k, kartlar, ayar } = await hazirla(eczaneId, b);
      const kalemler = kalemleriHazirla(k.recete.kalemler, kartlar, await stok.stok(eczaneId), b.kamuBedelleri ?? {}, bugun());
      return { kalemler, tutarlar: tutarHesapla(kalemler, b.tutarlar, ayar, !!b.muaf) };
    } catch (e) {
      return hata(reply, e);
    }
  });

  app.get<{ Querystring: { donem?: string } }>('/api/recete-satislari', async (req) =>
    (await d.satislar.liste(req.kullanici!.eczaneId))
      .filter((s) => (s.durum === 'satildi' || s.durum === 'iptal') && (!req.query.donem || donemi(s.tarih) === req.query.donem))
      .sort((a, b) => b.zaman.localeCompare(a.zaman)),
  );

  // Satış iki adımdır: kontrol kimliğiyle yer tutulur (aynı reçete iki kez satılamaz), sonra stok çıkışı,
  // veresiye borcu ve satış belgesi tek işlemde yazılır. Stok yetmezse yer tutma "başarısız" olur ve yeniden denenebilir.
  app.post<{ Body: SatisIstegi }>('/api/recete-satislari', async (req, reply) => {
    const b = req.body ?? {};
    const hatalar = istegiDogrula(b);
    if (!['nakit', 'kart', 'veresiye'].includes(b.hastaOdemeTuru as string)) hatalar.push('Hasta payının ödeme türü nakit, kart ya da veresiye olmalı');
    if (b.hastaOdemeTuru === 'veresiye' && !b.musteriId) hatalar.push('Veresiye için müşteri seçin');
    if (hatalar.length) return reply.code(400).send({ hata: 'Satış geçersiz', hatalar });
    const { eczaneId, id: kullaniciId, adSoyad } = req.kullanici!;
    const gun = bugun();

    try {
      const { k, kartlar, ayar } = await hazirla(eczaneId, b);
      const musteri = b.musteriId ? await cari.musteriAl(eczaneId, b.musteriId) : undefined;
      if (b.musteriId && !musteri) throw new ReceteSatisHatasi('Müşteri bulunamadı', 400);
      if ((await d.icmaller.al(eczaneId, `${KURUM}:${donemi(gun)}`))?.durum === 'kesildi')
        throw new ReceteSatisHatasi(`${donemi(gun)} döneminin faturası kesilmiş; bu döneme reçete eklenemez`);
      if (b.hastaOdemeTuru !== 'veresiye' && (await gunKapaliMi(eczaneId, gun))) throw new ReceteSatisHatasi(`${gun} günü kapatılmış; hasta payı kasaya alınamaz`);

      const taslak: ReceteSatisi = {
        id: k.id,
        kurum: KURUM,
        receteNo: k.recete.no,
        receteTuru: k.recete.tur,
        ...(k.takipNo ? { takipNo: k.takipNo } : {}),
        tarih: gun,
        kalemler: [],
        tutarlar: { toplamKurus: 0, fiyatFarkiKurus: 0, ilacKatilimKurus: 0, receteKatilimKurus: 0, muayeneKurus: 0, hastaPayiKurus: 0, kurumPayiKurus: 0, kaynak: 'ayar' },
        hastaOdemeTuru: b.hastaOdemeTuru!,
        ...(musteri ? { musteriId: musteri.id } : {}),
        ...(b.muaf ? { muaf: true } : {}),
        durum: 'hazirlaniyor',
        kullaniciId,
        kaydeden: adSoyad,
        zaman: new Date().toISOString(),
      };
      await d.satislar.degistir(eczaneId, [k.id], (m) => {
        const once = m.get(k.id);
        if (once && !(once.durum === 'basarisiz' || (once.durum === 'hazirlaniyor' && takiliMi(once, new Date()))))
          throw new ReceteSatisHatasi('Bu reçetenin satışı zaten yapılmış');
        return { sonuc: null, yaz: [taslak] };
      });

      try {
        const satis = await stok.islem(
          eczaneId,
          k.recete.kalemler.map((x) => x.barkod),
          (eldekiler) => {
            const kalemler = kalemleriHazirla(k.recete.kalemler, kartlar, eldekiler, b.kamuBedelleri ?? {}, gun);
            const s: ReceteSatisi = { ...taslak, kalemler, tutarlar: tutarHesapla(kalemler, b.tutarlar, ayar, !!b.muaf), durum: 'satildi' };
            const cariBorc: CariBorc | undefined =
              musteri && s.tutarlar.hastaPayiKurus > 0
                ? {
                    musteriAd: musteri.adSoyad,
                    limitKurus: musteri.limitKurus,
                    hareket: {
                      musteriId: musteri.id,
                      tur: 'borc',
                      tutarKurus: s.tutarlar.hastaPayiKurus,
                      aciklama: `Reçete ${s.receteNo} hasta payı`,
                      kullaniciId,
                      kaydeden: adSoyad,
                      zaman: s.zaman,
                    },
                  }
                : undefined;
            return { sonuc: s, hareketler: stokHareketleri(s, 'cikis'), cariBorc, belgeler: [{ tablo: 'recete_satisi', belge: s }] };
          },
        );
        return reply.code(201).send(satis);
      } catch (e) {
        await d.satislar.degistir(eczaneId, [k.id], () => ({ sonuc: null, yaz: [{ ...taslak, durum: 'basarisiz' }] }));
        throw e;
      }
    } catch (e) {
      return hata(reply, e);
    }
  });

  // İptal ilaçları aynı partilerle stoğa geri alır. Faturası kesilmiş dönemde, kapanmış günde ya da veresiyede yapılmaz.
  app.post<{ Params: { id: string }; Body: { neden?: string } }>('/api/recete-satislari/:id/iptal', { preHandler: eczaciGerekli }, async (req, reply) => {
    const neden = req.body?.neden?.trim();
    if (!neden || neden.length < 5) return reply.code(400).send({ hata: 'İptal nedenini en az 5 karakterle yazın' });
    const { eczaneId, adSoyad } = req.kullanici!;
    const id = req.params.id;
    try {
      const s = await d.satislar.al(eczaneId, id);
      if (!s || (s.durum !== 'satildi' && s.durum !== 'iptal-ediliyor')) throw new ReceteSatisHatasi('Satış bulunamadı', 404);
      if (s.hastaOdemeTuru === 'veresiye') throw new ReceteSatisHatasi('Veresiye reçete satışı iptal edilemez; müşteri carisinden düzeltin');
      if ((await d.icmaller.al(eczaneId, `${s.kurum}:${donemi(s.tarih)}`))?.durum === 'kesildi') throw new ReceteSatisHatasi('Bu dönemin faturası kesilmiş; satış iptal edilemez');
      if (await gunKapaliMi(eczaneId, s.tarih)) throw new ReceteSatisHatasi(`${s.tarih} günü kapatılmış; satış iptal edilemez`);

      const iptal = { neden, kaydeden: adSoyad, zaman: new Date().toISOString() };
      const mevcut = await d.satislar.degistir(eczaneId, [id], (m) => {
        const x = m.get(id)!;
        if (x.durum !== 'satildi' && !(x.durum === 'iptal-ediliyor' && takiliMi(x, new Date()))) throw new ReceteSatisHatasi('Bu satış zaten iptal ediliyor');
        return { sonuc: x, yaz: [{ ...x, durum: 'iptal-ediliyor', iptal }] };
      });
      try {
        const son: ReceteSatisi = { ...mevcut, durum: 'iptal', iptal };
        await stok.islem(
          eczaneId,
          mevcut.kalemler.map((k) => k.barkod),
          () => ({ sonuc: null, hareketler: stokHareketleri({ ...mevcut, kullaniciId: req.kullanici!.id, zaman: iptal.zaman }, 'iade'), belgeler: [{ tablo: 'recete_satisi', belge: son }] }),
        );
        return son;
      } catch (e) {
        await d.satislar.degistir(eczaneId, [id], () => ({ sonuc: null, yaz: [mevcut] }));
        throw e;
      }
    } catch (e) {
      return hata(reply, e);
    }
  });

  // ---- Dönem icmali ----

  app.get('/api/icmaller', { preHandler: eczaciGerekli }, async (req) =>
    (await d.icmaller.liste(req.kullanici!.eczaneId)).sort((a, b) => b.donem.localeCompare(a.donem)),
  );

  app.get<{ Params: { donem: string } }>('/api/icmaller/:donem', { preHandler: eczaciGerekli }, async (req, reply) => {
    const icmal = await d.icmaller.al(req.kullanici!.eczaneId, `${KURUM}:${req.params.donem}`);
    return icmal ?? reply.code(404).send({ hata: 'Bu dönemin icmali hazırlanmamış' });
  });

  // Taslak icmal o anki satışlardan hazırlanır; fatura kesilene kadar istendiği kadar yenilenebilir.
  app.post<{ Body: { donem?: string } }>('/api/icmaller', { preHandler: eczaciGerekli }, async (req, reply) => {
    const donem = req.body?.donem;
    if (!donem || !DONEM.test(donem)) return reply.code(400).send({ hata: 'Dönem YYYY-AA olmalı' });
    if (donem > donemi(bugun())) return reply.code(400).send({ hata: 'İleri bir dönemin icmali hazırlanamaz' });
    const eczaneId = req.kullanici!.eczaneId;
    const id = `${KURUM}:${donem}`;
    try {
      const satislar = await d.satislar.liste(eczaneId);
      const icmal = await d.icmaller.degistir(eczaneId, [id], (m) => {
        if (m.get(id)?.durum === 'kesildi') throw new ReceteSatisHatasi('Bu dönemin faturası kesilmiş; icmal değiştirilemez');
        const i = icmalHazirla(KURUM, donem, satislar, req.kullanici!.adSoyad, new Date().toISOString());
        return { sonuc: i, yaz: [i] };
      });
      return reply.code(201).send(icmal);
    } catch (e) {
      return hata(reply, e);
    }
  });

  // Fatura kesilince icmal son satışlarla yeniden hazırlanır ve kilitlenir; o döneme satış eklenemez, iptal edilemez.
  app.post<{ Params: { donem: string }; Body: { faturaNo?: string; faturaTarihi?: string } }>(
    '/api/icmaller/:donem/kes',
    { preHandler: eczaciGerekli },
    async (req, reply) => {
      const { faturaNo, faturaTarihi } = req.body ?? {};
      const donem = req.params.donem;
      const hatalar: string[] = [];
      if (!DONEM.test(donem)) hatalar.push('Dönem YYYY-AA olmalı');
      if (!faturaNo?.trim()) hatalar.push('Kurum faturasının numarasını girin');
      if (!faturaTarihi || !TARIH.test(faturaTarihi)) hatalar.push('Fatura tarihi YYYY-AA-GG olmalı');
      else if (faturaTarihi > bugun()) hatalar.push('Fatura tarihi ileri bir gün olamaz');
      if (hatalar.length) return reply.code(400).send({ hata: 'Fatura bilgileri geçersiz', hatalar });
      const eczaneId = req.kullanici!.eczaneId;
      const id = `${KURUM}:${donem}`;
      try {
        const satislar = await d.satislar.liste(eczaneId);
        if (satislar.some((s) => donemi(s.tarih) === donem && (s.durum === 'hazirlaniyor' || s.durum === 'iptal-ediliyor')))
          throw new ReceteSatisHatasi('Bu dönemde yarım kalmış bir satış ya da iptal var; birkaç dakika sonra yeniden deneyin');
        const zaman = new Date().toISOString();
        const icmal = await d.icmaller.degistir(eczaneId, [id], (m) => {
          if (m.get(id)?.durum === 'kesildi') throw new ReceteSatisHatasi('Bu dönemin faturası zaten kesilmiş');
          const i = icmalHazirla(KURUM, donem, satislar, req.kullanici!.adSoyad, zaman);
          if (i.receteSayisi === 0) throw new ReceteSatisHatasi('Bu dönemde faturalanacak reçete yok');
          const kesilen: Icmal = { ...i, durum: 'kesildi', fatura: { no: faturaNo!.trim(), tarih: faturaTarihi!, kesen: req.kullanici!.adSoyad, zaman } };
          return { sonuc: kesilen, yaz: [kesilen] };
        });
        return icmal;
      } catch (e) {
        return hata(reply, e);
      }
    },
  );

  // ---- Kurum carisi ----

  app.get('/api/kurum-carisi', { preHandler: eczaciGerekli }, async (req) => {
    const eczaneId = req.kullanici!.eczaneId;
    const [satislar, tahsilatlar, icmaller] = await Promise.all([d.satislar.liste(eczaneId), d.tahsilatlar.liste(eczaneId), d.icmaller.liste(eczaneId)]);
    return { ...kurumCarisi(KURUM, satislar, tahsilatlar, icmaller), tahsilatlar: tahsilatlar.sort((a, b) => b.tarih.localeCompare(a.tarih)) };
  });

  app.post<{ Body: Partial<KurumTahsilati> }>('/api/kurum-carisi/tahsilat', { preHandler: eczaciGerekli }, async (req, reply) => {
    const b = req.body ?? {};
    const hatalar: string[] = [];
    if (!Number.isInteger(b.tutarKurus) || b.tutarKurus! <= 0) hatalar.push('Tutar pozitif olmalı');
    if (!b.tarih || !TARIH.test(b.tarih)) hatalar.push('Tarih YYYY-AA-GG olmalı');
    else if (b.tarih > bugun()) hatalar.push('Tarih ileri bir gün olamaz');
    const eczaneId = req.kullanici!.eczaneId;
    if (b.icmalId && !(await d.icmaller.al(eczaneId, b.icmalId))) hatalar.push('İcmal bulunamadı');
    if (hatalar.length) return reply.code(400).send({ hata: 'Tahsilat geçersiz', hatalar });
    const t: KurumTahsilati = {
      id: randomUUID(),
      kurum: KURUM,
      tutarKurus: b.tutarKurus!,
      tarih: b.tarih!,
      ...(b.icmalId ? { icmalId: b.icmalId } : {}),
      ...(b.aciklama?.trim() ? { aciklama: b.aciklama.trim() } : {}),
      kaydeden: req.kullanici!.adSoyad,
      zaman: new Date().toISOString(),
    };
    await d.tahsilatlar.degistir(eczaneId, [], () => ({ sonuc: null, yaz: [t] }));
    return reply.code(201).send(t);
  });
}
