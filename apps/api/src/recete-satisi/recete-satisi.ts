import type { ReceteTuru } from '@scalpiq/sut-motoru';
import { fefoDagit, type Parti, type StokHareketi, type Urun } from '../stok/stok.js';

// Reçeteli satış: Medula'ya gönderilmiş reçetenin ilaçları verilir, tutar SGK'nın ödeyeceği kurum payı ile
// hastanın ödeyeceği paya ayrılır. Kurum payları SGK carisine alacak yazılır ve ay sonunda dönem icmaline
// (eczane faturasına esas döküm) toplanır. Tutarlar kuruş cinsinden tamsayıdır.
//
// Hasta payının resmî tutarı Medula provizyonunda hesaplanır; Medula bağlantısı gelince tutarlar oradan gelir.
// O zamana kadar eczacı ya Medula ekranındaki tutarları girer ya da kendi girdiği katılım payı ayarlarıyla
// hesaplatır. Ayarların değerleri burada uydurulmaz; SUT'taki güncel tutarları eczacı girer ve onaylar.

export const KURUM = 'SGK';

export interface KatilimAyarlari {
  /** İlaç bedeli üzerinden katılım payı yüzdesi (SUT 1.8) */
  ilacKatilimYuzde: number;
  /** Reçete başına alınan sabit katılım payı (kutu sayısına göre) */
  receteKatilim: { ilkKutuSayisi: number; ilkKutularKurus: number; sonrakiKutuKurus: number };
  /** Eczanede tahsil edilen muayene katılım payı (yoksa 0) */
  muayeneKurus: number;
  onaylayan: string;
  tarih: string;
}

export interface ReceteSatisKalemi {
  barkod: string;
  ad: string;
  adet: number;
  /** KDV dahil perakende satış fiyatı (kutu) */
  birimFiyatKurus: number;
  /** SGK'nın ödeyeceği kutu bedeli; perakendeden düşükse aradaki fark hastadan alınır */
  kamuBedeliKurus: number;
  partiler: Parti[];
}

export interface ReceteTutarlari {
  toplamKurus: number;
  fiyatFarkiKurus: number;
  ilacKatilimKurus: number;
  receteKatilimKurus: number;
  muayeneKurus: number;
  hastaPayiKurus: number;
  kurumPayiKurus: number;
  /** Tutarlar nereden geldi: eczacının girdiği Medula tutarları ya da katılım payı ayarları */
  kaynak: 'medula' | 'ayar';
}

export type ReceteSatisDurumu = 'hazirlaniyor' | 'basarisiz' | 'satildi' | 'iptal-ediliyor' | 'iptal';
export type HastaOdemeTuru = 'nakit' | 'kart' | 'veresiye';

export interface ReceteSatisi {
  /** Kontrol kimliğiyle aynıdır: bir reçete bir kez satılır */
  id: string;
  kurum: string;
  receteNo: string;
  receteTuru: ReceteTuru;
  takipNo?: string;
  /** Satış günü (YYYY-AA-GG); dönem icmali buna göre toplanır */
  tarih: string;
  kalemler: ReceteSatisKalemi[];
  tutarlar: ReceteTutarlari;
  hastaOdemeTuru: HastaOdemeTuru;
  musteriId?: string;
  muaf?: boolean;
  durum: ReceteSatisDurumu;
  iptal?: { neden: string; kaydeden: string; zaman: string };
  kullaniciId: string;
  kaydeden: string;
  zaman: string;
}

export class ReceteSatisHatasi extends Error {
  constructor(
    mesaj: string,
    readonly kod = 409,
  ) {
    super(mesaj);
  }
}

export const donemi = (tarih: string) => tarih.slice(0, 7);

export function ayarDogrula(a: Partial<KatilimAyarlari> | undefined): string[] {
  const h: string[] = [];
  const tamsayi = (x: unknown) => Number.isInteger(x) && (x as number) >= 0;
  if (typeof a?.ilacKatilimYuzde !== 'number' || a.ilacKatilimYuzde < 0 || a.ilacKatilimYuzde > 100) h.push('İlaç katılım yüzdesi 0-100 arasında olmalı');
  const r = a?.receteKatilim;
  if (!r || !tamsayi(r.ilkKutuSayisi) || !tamsayi(r.ilkKutularKurus) || !tamsayi(r.sonrakiKutuKurus))
    h.push('Reçete katılım payı için kutu sayısı ve kuruş tutarları sıfır ya da pozitif tamsayı olmalı');
  if (!tamsayi(a?.muayeneKurus)) h.push('Muayene katılım payı kuruş cinsinden sıfır ya da pozitif tamsayı olmalı');
  return h;
}

/** Reçete katılım payı: ilk N kutu için sabit tutar, sonraki her kutu için ek tutar. */
export function receteKatilimi(kutu: number, r: KatilimAyarlari['receteKatilim']) {
  if (kutu <= 0) return 0;
  return r.ilkKutularKurus + Math.max(0, kutu - r.ilkKutuSayisi) * r.sonrakiKutuKurus;
}

export interface ElleTutarlar {
  ilacKatilimKurus?: number;
  receteKatilimKurus?: number;
  muayeneKurus?: number;
  fiyatFarkiKurus?: number;
}

/**
 * Tutarları hesaplar. Medula tutarları verildiyse onlar kullanılır; verilmeyen kalem için ayar yoksa hata verir.
 * Muaf hastadan ilaç ve reçete katılım payı alınmaz, fiyat farkı yine alınır. Hasta payı reçete tutarını aşamaz.
 */
export function tutarHesapla(
  kalemler: Pick<ReceteSatisKalemi, 'adet' | 'birimFiyatKurus' | 'kamuBedeliKurus'>[],
  elle: ElleTutarlar | undefined,
  ayar: KatilimAyarlari | undefined,
  muaf: boolean,
): ReceteTutarlari {
  const toplamKurus = kalemler.reduce((t, k) => t + k.adet * k.birimFiyatKurus, 0);
  const kamuToplami = kalemler.reduce((t, k) => t + k.adet * Math.min(k.kamuBedeliKurus, k.birimFiyatKurus), 0);
  const kutu = kalemler.reduce((t, k) => t + k.adet, 0);
  const tamMedula = elle && ['ilacKatilimKurus', 'receteKatilimKurus', 'muayeneKurus'].every((a) => elle[a as keyof ElleTutarlar] !== undefined);
  if (!tamMedula && !ayar) throw new ReceteSatisHatasi('Hasta payını hesaplamak için Medula tutarlarını girin ya da katılım payı ayarlarını kaydedin', 400);
  const sec = (deger: number | undefined, hesap: () => number) => (deger !== undefined ? deger : hesap());
  const fiyatFarkiKurus = sec(elle?.fiyatFarkiKurus, () => toplamKurus - kamuToplami);
  const ilacKatilimKurus = muaf ? 0 : sec(elle?.ilacKatilimKurus, () => Math.round((kamuToplami * ayar!.ilacKatilimYuzde) / 100));
  const receteKatilimKurus = muaf ? 0 : sec(elle?.receteKatilimKurus, () => receteKatilimi(kutu, ayar!.receteKatilim));
  const muayeneKurus = sec(elle?.muayeneKurus, () => ayar!.muayeneKurus);
  const hastaPayiKurus = Math.min(toplamKurus, fiyatFarkiKurus + ilacKatilimKurus + receteKatilimKurus + muayeneKurus);
  return {
    toplamKurus,
    fiyatFarkiKurus,
    ilacKatilimKurus,
    receteKatilimKurus,
    muayeneKurus,
    hastaPayiKurus,
    kurumPayiKurus: toplamKurus - hastaPayiKurus,
    kaynak: tamMedula ? 'medula' : 'ayar',
  };
}

/** Reçetedeki kutuları stoktan FEFO ile düşer. */
export function kalemleriHazirla(
  receteKalemleri: { barkod: string; adet: number }[],
  urunler: Map<string, Urun>,
  eldekiler: Map<string, Parti[]>,
  kamuBedelleri: Record<string, number>,
  bugun: string,
): ReceteSatisKalemi[] {
  return receteKalemleri.map((k) => {
    const u = urunler.get(k.barkod);
    if (!u) throw new ReceteSatisHatasi(`${k.barkod} barkodlu ilacın ürün kartı yok; önce kartını açın`);
    return {
      barkod: k.barkod,
      ad: u.ad,
      adet: k.adet,
      birimFiyatKurus: u.satisFiyatiKurus,
      kamuBedeliKurus: kamuBedelleri[k.barkod] ?? u.satisFiyatiKurus,
      partiler: fefoDagit(eldekiler.get(k.barkod) ?? [], k.adet, bugun, u.ad),
    };
  });
}

export function stokHareketleri(s: Pick<ReceteSatisi, 'receteNo' | 'kalemler' | 'kullaniciId' | 'zaman'>, yon: 'cikis' | 'iade'): StokHareketi[] {
  return s.kalemler.flatMap((k) =>
    k.partiler.map(
      (p): StokHareketi => ({
        barkod: k.barkod,
        tur: yon === 'cikis' ? 'recete' : 'giris',
        miktar: yon === 'cikis' ? -p.miktar : p.miktar,
        partiNo: p.partiNo,
        skt: p.skt,
        aciklama: yon === 'cikis' ? `Reçete ${s.receteNo}` : `Reçete ${s.receteNo} satış iptali`,
        kullaniciId: s.kullaniciId,
        zaman: s.zaman,
      }),
    ),
  );
}

/** Takılı kalmış hazırlık ya da iptal 5 dakika sonra yeniden denenebilir. */
export const takiliMi = (s: ReceteSatisi, simdi: Date) => simdi.getTime() - Date.parse(s.iptal?.zaman ?? s.zaman) > 5 * 60_000;

// ---- Dönem icmali ----

export interface IcmalRecetesi {
  id: string;
  receteNo: string;
  takipNo?: string;
  receteTuru: ReceteTuru;
  tarih: string;
  toplamKurus: number;
  kurumPayiKurus: number;
  hastaPayiKurus: number;
}

export interface Icmal {
  /** KURUM:YYYY-AA */
  id: string;
  kurum: string;
  donem: string;
  durum: 'taslak' | 'kesildi';
  receteler: IcmalRecetesi[];
  dokum: { receteTuru: ReceteTuru; receteSayisi: number; toplamKurus: number; kurumPayiKurus: number; hastaPayiKurus: number }[];
  receteSayisi: number;
  toplamKurus: number;
  kurumPayiKurus: number;
  hastaPayiKurus: number;
  fatura?: { no: string; tarih: string; kesen: string; zaman: string };
  hazirlayan: string;
  zaman: string;
}

export function icmalHazirla(kurum: string, donem: string, satislar: ReceteSatisi[], hazirlayan: string, zaman: string): Icmal {
  const receteler = satislar
    .filter((s) => s.kurum === kurum && s.durum === 'satildi' && donemi(s.tarih) === donem)
    .sort((a, b) => a.tarih.localeCompare(b.tarih) || a.receteNo.localeCompare(b.receteNo))
    .map(
      (s): IcmalRecetesi => ({
        id: s.id,
        receteNo: s.receteNo,
        ...(s.takipNo ? { takipNo: s.takipNo } : {}),
        receteTuru: s.receteTuru,
        tarih: s.tarih,
        toplamKurus: s.tutarlar.toplamKurus,
        kurumPayiKurus: s.tutarlar.kurumPayiKurus,
        hastaPayiKurus: s.tutarlar.hastaPayiKurus,
      }),
    );
  const dokum = new Map<ReceteTuru, Icmal['dokum'][number]>();
  for (const r of receteler) {
    const d = dokum.get(r.receteTuru) ?? { receteTuru: r.receteTuru, receteSayisi: 0, toplamKurus: 0, kurumPayiKurus: 0, hastaPayiKurus: 0 };
    d.receteSayisi++;
    d.toplamKurus += r.toplamKurus;
    d.kurumPayiKurus += r.kurumPayiKurus;
    d.hastaPayiKurus += r.hastaPayiKurus;
    dokum.set(r.receteTuru, d);
  }
  const topla = (f: (r: IcmalRecetesi) => number) => receteler.reduce((t, r) => t + f(r), 0);
  return {
    id: `${kurum}:${donem}`,
    kurum,
    donem,
    durum: 'taslak',
    receteler,
    dokum: [...dokum.values()].sort((a, b) => a.receteTuru.localeCompare(b.receteTuru)),
    receteSayisi: receteler.length,
    toplamKurus: topla((r) => r.toplamKurus),
    kurumPayiKurus: topla((r) => r.kurumPayiKurus),
    hastaPayiKurus: topla((r) => r.hastaPayiKurus),
    hazirlayan,
    zaman,
  };
}

// ---- Kurum carisi ----

export interface KurumTahsilati {
  id: string;
  kurum: string;
  tutarKurus: number;
  tarih: string;
  /** Ödemenin karşılığı olan icmal (KURUM:YYYY-AA) */
  icmalId?: string;
  aciklama?: string;
  kaydeden: string;
  zaman: string;
}

export function kurumCarisi(kurum: string, satislar: ReceteSatisi[], tahsilatlar: KurumTahsilati[], icmaller: Icmal[]) {
  const satilan = satislar.filter((s) => s.kurum === kurum && s.durum === 'satildi');
  const alacakKurus = satilan.reduce((t, s) => t + s.tutarlar.kurumPayiKurus, 0);
  const tahsilatKurus = tahsilatlar.filter((t) => t.kurum === kurum).reduce((t, x) => t + x.tutarKurus, 0);
  const faturalanan = new Set(icmaller.filter((i) => i.kurum === kurum && i.durum === 'kesildi').map((i) => i.donem));
  return {
    kurum,
    alacakKurus,
    tahsilatKurus,
    bakiyeKurus: alacakKurus - tahsilatKurus,
    /** Faturası henüz kesilmemiş dönemlerin kurum payı */
    faturalanmamisKurus: satilan.filter((s) => !faturalanan.has(donemi(s.tarih))).reduce((t, s) => t + s.tutarlar.kurumPayiKurus, 0),
  };
}
