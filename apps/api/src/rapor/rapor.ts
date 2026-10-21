import { icKdv, MIAD_UYARI_GUNU, miadiGecmis, type KdvOrani, type Parti, type Satis, type StokHareketi, type Urun } from '../stok/stok.js';
import type { CariHareket } from '../cari/cari.js';
import type { KasaEtkisi } from '../gelir-gider/gelir-gider.js';

// Gün sonu ve raporlar. Hiçbiri yeni kayıt üretmez; satışlardan, stok hareketlerinden ve cari hareketlerden hesaplanır.
// Maliyet, satılan partinin stoğa giriş maliyetidir (KDV hariç). Maliyeti girilmemiş partiler ayrıca sayılır,
// kâr o kutular dışarıda bırakılarak hesaplanır ki eksik veri kârı şişirmesin.

const partiAnahtari = (barkod: string, partiNo: string, skt: string) => `${barkod}|${partiNo}|${skt}`;

/** Her partinin birim maliyeti; aynı partiye farklı maliyetle birden çok giriş varsa adetle ağırlıklı ortalama. */
export function partiMaliyetleri(girisler: Pick<StokHareketi, 'barkod' | 'partiNo' | 'skt' | 'miktar' | 'birimMaliyetKurus'>[]) {
  const toplam = new Map<string, { adet: number; kurus: number }>();
  for (const g of girisler) {
    if (g.birimMaliyetKurus === undefined || g.miktar <= 0) continue;
    const a = partiAnahtari(g.barkod, g.partiNo, g.skt);
    const t = toplam.get(a) ?? { adet: 0, kurus: 0 };
    t.adet += g.miktar;
    t.kurus += g.miktar * g.birimMaliyetKurus;
    toplam.set(a, t);
  }
  return new Map([...toplam].map(([a, t]) => [a, Math.round(t.kurus / t.adet)]));
}

export type Maliyetler = ReturnType<typeof partiMaliyetleri>;

export interface KdvSatiri {
  oran: KdvOrani;
  /** KDV dahil tutar */
  tutarKurus: number;
  matrahKurus: number;
  kdvKurus: number;
}

export interface SatisOzeti {
  adet: number;
  ciroKurus: number;
  nakitKurus: number;
  kartKurus: number;
  veresiyeKurus: number;
  kdvKurus: number;
  /** KDV hariç ciro */
  matrahKurus: number;
  /** Maliyeti bilinen kutuların maliyeti */
  maliyetKurus: number;
  /** Maliyeti bilinen kutuların KDV hariç satışı eksi maliyeti */
  brutKarKurus: number;
  /** Maliyeti girilmemiş partiden satılan kutu sayısı */
  maliyetsizKutu: number;
  kdvDokumu: KdvSatiri[];
}

export function satisOzeti(satislar: Satis[], maliyetler: Maliyetler): SatisOzeti {
  const o: SatisOzeti = {
    adet: satislar.length,
    ciroKurus: 0,
    nakitKurus: 0,
    kartKurus: 0,
    veresiyeKurus: 0,
    kdvKurus: 0,
    matrahKurus: 0,
    maliyetKurus: 0,
    brutKarKurus: 0,
    maliyetsizKutu: 0,
    kdvDokumu: [],
  };
  const kdv = new Map<KdvOrani, KdvSatiri>();
  for (const s of satislar) {
    o.ciroKurus += s.toplamKurus;
    o[`${s.odemeTuru}Kurus`] += s.toplamKurus;
    for (const k of s.kalemler) {
      const kalemKdv = icKdv(k.tutarKurus, k.kdvOrani);
      const satir = kdv.get(k.kdvOrani) ?? { oran: k.kdvOrani, tutarKurus: 0, matrahKurus: 0, kdvKurus: 0 };
      satir.tutarKurus += k.tutarKurus;
      satir.kdvKurus += kalemKdv;
      satir.matrahKurus += k.tutarKurus - kalemKdv;
      kdv.set(k.kdvOrani, satir);
      // Kalemin birim matrahı; maliyeti bilinen kutuların kârı buradan çıkar.
      const birimMatrah = (k.tutarKurus - kalemKdv) / k.miktar;
      for (const p of k.partiler) {
        const m = maliyetler.get(partiAnahtari(k.barkod, p.partiNo, p.skt));
        if (m === undefined) o.maliyetsizKutu += p.miktar;
        else {
          o.maliyetKurus += m * p.miktar;
          o.brutKarKurus += birimMatrah * p.miktar - m * p.miktar;
        }
      }
    }
  }
  o.brutKarKurus = Math.round(o.brutKarKurus);
  o.kdvDokumu = [...kdv.values()].sort((a, b) => a.oran - b.oran);
  o.kdvKurus = o.kdvDokumu.reduce((t, s) => t + s.kdvKurus, 0);
  o.matrahKurus = o.ciroKurus - o.kdvKurus;
  return o;
}

export interface KasaBeklentisi {
  nakitSatisKurus: number;
  nakitTahsilatKurus: number;
  kartSatisKurus: number;
  kartTahsilatKurus: number;
  /** Gelir-gider kayıtlarından ve depo ödemelerinden gelen kasa hareketleri (bu modülden önceki kapanışlarda yok) */
  nakitGelirKurus?: number;
  nakitGiderKurus?: number;
  kartGelirKurus?: number;
  /** Kasada olması gereken nakit: nakit satış + nakit tahsilat + nakit gelir − nakit gider */
  beklenenNakitKurus: number;
  /** POS'tan geçmesi gereken: kart satış + kart tahsilat + kartla alınan gelir */
  beklenenKartKurus: number;
}

export function kasaBeklentisi(
  satislar: Satis[],
  tahsilatlar: Pick<CariHareket, 'tutarKurus' | 'odemeTuru'>[],
  diger: KasaEtkisi = { nakitGelirKurus: 0, nakitGiderKurus: 0, kartGelirKurus: 0 },
): KasaBeklentisi {
  const satis = (t: string) => satislar.filter((s) => s.odemeTuru === t).reduce((a, s) => a + s.toplamKurus, 0);
  const tahsilat = (t: string) => tahsilatlar.filter((h) => h.odemeTuru === t).reduce((a, h) => a + h.tutarKurus, 0);
  const b = {
    nakitSatisKurus: satis('nakit'),
    nakitTahsilatKurus: tahsilat('nakit'),
    kartSatisKurus: satis('kart'),
    kartTahsilatKurus: tahsilat('kart'),
    ...diger,
  };
  return {
    ...b,
    beklenenNakitKurus: b.nakitSatisKurus + b.nakitTahsilatKurus + b.nakitGelirKurus - b.nakitGiderKurus,
    beklenenKartKurus: b.kartSatisKurus + b.kartTahsilatKurus + b.kartGelirKurus,
  };
}

export interface UrunSatisi {
  barkod: string;
  ad: string;
  miktar: number;
  ciroKurus: number;
}

/** Dönemde en çok ciro yapan ürünler. */
export function urunSatislari(satislar: Satis[], adet = 20): UrunSatisi[] {
  const m = new Map<string, UrunSatisi>();
  for (const s of satislar)
    for (const k of s.kalemler) {
      const u = m.get(k.barkod) ?? { barkod: k.barkod, ad: k.ad, miktar: 0, ciroKurus: 0 };
      u.miktar += k.miktar;
      u.ciroKurus += k.tutarKurus;
      m.set(k.barkod, u);
    }
  return [...m.values()].sort((a, b) => b.ciroKurus - a.ciroKurus || a.ad.localeCompare(b.ad, 'tr')).slice(0, adet);
}

export interface StokDegeriSatiri {
  barkod: string;
  ad: string;
  miktar: number;
  /** Maliyeti bilinen kutuların maliyeti (KDV hariç) */
  maliyetKurus: number;
  /** Raf fiyatıyla değeri (KDV dahil) */
  satisDegeriKurus: number;
  maliyetsizKutu: number;
  miadiGecmisKutu: number;
}

export interface MiadSatiri {
  barkod: string;
  ad: string;
  partiNo: string;
  skt: string;
  miktar: number;
  kalanGun: number;
  maliyetKurus?: number;
}

const gunFarki = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

/** Eldeki stoğun maliyet ve raf değeri; miadı geçmiş ve yaklaşan partiler. */
export function stokRaporu(urunler: Urun[], stok: Map<string, Parti[]>, maliyetler: Maliyetler, bugun: string, miadGunu = MIAD_UYARI_GUNU) {
  const kalemler: StokDegeriSatiri[] = [];
  const miad: MiadSatiri[] = [];
  for (const u of urunler) {
    const partiler = stok.get(u.barkod) ?? [];
    const satir: StokDegeriSatiri = { barkod: u.barkod, ad: u.ad, miktar: 0, maliyetKurus: 0, satisDegeriKurus: 0, maliyetsizKutu: 0, miadiGecmisKutu: 0 };
    for (const p of partiler) {
      const m = maliyetler.get(partiAnahtari(u.barkod, p.partiNo, p.skt));
      satir.miktar += p.miktar;
      satir.satisDegeriKurus += p.miktar * u.satisFiyatiKurus;
      if (m === undefined) satir.maliyetsizKutu += p.miktar;
      else satir.maliyetKurus += p.miktar * m;
      if (miadiGecmis(p.skt, bugun)) satir.miadiGecmisKutu += p.miktar;
      const kalanGun = gunFarki(bugun, p.skt);
      if (kalanGun <= miadGunu)
        miad.push({ barkod: u.barkod, ad: u.ad, partiNo: p.partiNo, skt: p.skt, miktar: p.miktar, kalanGun, ...(m === undefined ? {} : { maliyetKurus: m * p.miktar }) });
    }
    if (satir.miktar > 0) kalemler.push(satir);
  }
  kalemler.sort((a, b) => b.maliyetKurus - a.maliyetKurus || a.ad.localeCompare(b.ad, 'tr'));
  miad.sort((a, b) => a.skt.localeCompare(b.skt) || a.ad.localeCompare(b.ad, 'tr'));
  const topla = (f: (s: StokDegeriSatiri) => number) => kalemler.reduce((t, s) => t + f(s), 0);
  return {
    kalemler,
    miad,
    toplam: {
      cesit: kalemler.length,
      kutu: topla((s) => s.miktar),
      maliyetKurus: topla((s) => s.maliyetKurus),
      satisDegeriKurus: topla((s) => s.satisDegeriKurus),
      maliyetsizKutu: topla((s) => s.maliyetsizKutu),
      miadiGecmisKutu: topla((s) => s.miadiGecmisKutu),
    },
  };
}

/** Kasa kapanışı: o günün beklenen tutarları ve sayılan nakit. Bir gün bir kez kapanır, kayıt değiştirilmez. */
export interface GunSonu {
  gun: string;
  zaman: string;
  kullaniciId: string;
  kapatan: string;
  satisAdedi: number;
  ciroKurus: number;
  veresiyeKurus: number;
  kasa: KasaBeklentisi;
  sayilanNakitKurus: number;
  /** Sayılan eksi beklenen; eksi ise kasa açığı */
  farkKurus: number;
  aciklama?: string;
}

export class GunZatenKapaliHatasi extends Error {
  constructor(gun: string) {
    super(`${gun} günü zaten kapatılmış`);
  }
}

export interface GunSonuDeposu {
  /** Gün daha önce kapandıysa GunZatenKapaliHatasi fırlatır. */
  kapat(eczaneId: string, g: GunSonu): Promise<void>;
  al(eczaneId: string, gun: string): Promise<GunSonu | undefined>;
  /** Son kapanışlar, en yenisi önce. */
  liste(eczaneId: string, adet: number): Promise<GunSonu[]>;
}

export class BellekGunSonuDeposu implements GunSonuDeposu {
  private kayitlar: (GunSonu & { eczaneId: string })[] = [];

  async kapat(eczaneId: string, g: GunSonu) {
    if (this.kayitlar.some((k) => k.eczaneId === eczaneId && k.gun === g.gun)) throw new GunZatenKapaliHatasi(g.gun);
    this.kayitlar.push(structuredClone({ ...g, eczaneId }));
  }

  async al(eczaneId: string, gun: string) {
    const k = this.kayitlar.find((x) => x.eczaneId === eczaneId && x.gun === gun);
    if (!k) return undefined;
    const { eczaneId: _e, ...g } = k;
    return structuredClone(g);
  }

  async liste(eczaneId: string, adet: number) {
    return this.kayitlar
      .filter((k) => k.eczaneId === eczaneId)
      .sort((a, b) => b.gun.localeCompare(a.gun))
      .slice(0, adet)
      .map(({ eczaneId: _e, ...g }) => structuredClone(g));
  }
}
