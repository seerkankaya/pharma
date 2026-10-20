// Stok ve satışın hesap kuralları. Depodan bağımsızdır; bellek ve PostgreSQL depoları aynı kuralları kullanır.
// Stok, yalnızca eklenen hareketlerden (giriş, satış, imha) hesaplanır; hiçbir hareket silinmez ya da değiştirilmez.
// Tutarlar kuruş cinsinden tamsayıdır. Satış fiyatları KDV dahildir.

export type KdvOrani = 0 | 1 | 10 | 20;
export const KDV_ORANLARI: KdvOrani[] = [0, 1, 10, 20];

export interface Urun {
  barkod: string;
  ad: string;
  /** EK-4/A listesinde olan ürün */
  ilac: boolean;
  kdvOrani: KdvOrani;
  satisFiyatiKurus: number;
  /** Stok bu sayıya ya da altına inince uyarı verilir */
  kritikStok?: number;
}

export type HareketTuru = 'giris' | 'satis' | 'imha';

export interface StokHareketi {
  barkod: string;
  tur: HareketTuru;
  /** Girişte artı, satış ve imhada eksi */
  miktar: number;
  partiNo: string;
  /** Son kullanma tarihi (YYYY-AA-GG) */
  skt: string;
  birimMaliyetKurus?: number;
  satisId?: string;
  aciklama?: string;
  kullaniciId: string;
  zaman: string;
}

export interface Parti {
  partiNo: string;
  skt: string;
  miktar: number;
}

export type OdemeTuru = 'nakit' | 'kart';

export interface SatisKalemi {
  barkod: string;
  ad: string;
  miktar: number;
  birimFiyatKurus: number;
  kdvOrani: KdvOrani;
  tutarKurus: number;
  /** Hangi partilerden düşüldüğü (son kullanma tarihi en yakın olandan başlayarak) */
  partiler: Parti[];
}

export interface Satis {
  id: string;
  zaman: string;
  kullaniciId: string;
  satan: string;
  odemeTuru: OdemeTuru;
  kalemler: SatisKalemi[];
  toplamKurus: number;
  kdvKurus: number;
}

export class StokHatasi extends Error {}

/** Verilen anın Türkiye saatine göre tarihi (YYYY-AA-GG). Gece yarısından sonra UTC tarihi bir gün geride kalır. */
export const turkiyeGunu = (an: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(an);

/** Hareketlerden ürünün elde kalan partilerini, son kullanma tarihine göre sıralı verir. */
export function partiler(hareketler: Pick<StokHareketi, 'partiNo' | 'skt' | 'miktar'>[]): Parti[] {
  const m = new Map<string, Parti>();
  for (const h of hareketler) {
    const anahtar = `${h.partiNo}|${h.skt}`;
    const p = m.get(anahtar) ?? { partiNo: h.partiNo, skt: h.skt, miktar: 0 };
    p.miktar += h.miktar;
    m.set(anahtar, p);
  }
  return [...m.values()].filter((p) => p.miktar > 0).sort((a, b) => a.skt.localeCompare(b.skt) || a.partiNo.localeCompare(b.partiNo));
}

/** Son kullanma tarihi geçmiş mi? SKT günü dahil satılabilir. */
export const miadiGecmis = (skt: string, bugun: string) => skt < bugun;

/**
 * Satılacak miktarı, miadı geçmemiş partilerden son kullanma tarihi en yakın olandan başlayarak düşer (FEFO).
 * Miadı geçmiş parti hiçbir koşulda satılmaz. Yeterli stok yoksa StokHatasi fırlatır.
 */
export function fefoDagit(eldekiler: Parti[], miktar: number, bugun: string, urunAdi: string): Parti[] {
  const satilabilir = eldekiler.filter((p) => !miadiGecmis(p.skt, bugun));
  const toplam = satilabilir.reduce((t, p) => t + p.miktar, 0);
  if (toplam < miktar) {
    const miadli = eldekiler.length > satilabilir.length ? ' (miadı geçmiş partiler satılamaz)' : '';
    throw new StokHatasi(`${urunAdi}: stokta ${toplam} adet var, ${miktar} adet istendi${miadli}`);
  }
  const sonuc: Parti[] = [];
  let kalan = miktar;
  for (const p of satilabilir) {
    if (kalan === 0) break;
    const al = Math.min(p.miktar, kalan);
    sonuc.push({ partiNo: p.partiNo, skt: p.skt, miktar: al });
    kalan -= al;
  }
  return sonuc;
}

/** KDV dahil tutarın içindeki KDV. */
export const icKdv = (tutarKurus: number, oran: KdvOrani) => Math.round((tutarKurus * oran) / (100 + oran));

export interface SatisIstegi {
  kalemler: { barkod: string; miktar: number }[];
  odemeTuru: OdemeTuru;
}

export function satisIstegiDogrula(istek: Partial<SatisIstegi> | undefined): string[] {
  const h: string[] = [];
  if (!Array.isArray(istek?.kalemler) || istek.kalemler.length === 0) h.push('Sepet boş');
  else {
    for (const k of istek.kalemler)
      if (typeof k?.barkod !== 'string' || !Number.isInteger(k.miktar) || k.miktar < 1) h.push('Her kalemde barkod ve 1 ya da daha büyük tamsayı miktar olmalı');
    if (new Set(istek.kalemler.map((k) => k.barkod)).size !== istek.kalemler.length) h.push('Aynı ürün sepette iki kez olamaz; miktarını artırın');
  }
  if (istek?.odemeTuru !== 'nakit' && istek?.odemeTuru !== 'kart') h.push('Ödeme türü nakit ya da kart olmalı');
  return [...new Set(h)];
}

/**
 * Satışı hazırlar: fiyat ve KDV ürün kartından alınır (istemciden gelen fiyata güvenilmez),
 * miktar partilere FEFO ile dağıtılır.
 */
export function satisHazirla(
  istek: SatisIstegi,
  urunler: Map<string, Urun>,
  eldekiPartiler: Map<string, Parti[]>,
  bugun: string,
): Omit<Satis, 'id' | 'zaman' | 'kullaniciId' | 'satan'> {
  const kalemler = istek.kalemler.map((k): SatisKalemi => {
    const u = urunler.get(k.barkod);
    if (!u) throw new StokHatasi(`${k.barkod} barkodlu ürünün kartı yok`);
    const tutarKurus = u.satisFiyatiKurus * k.miktar;
    return {
      barkod: u.barkod,
      ad: u.ad,
      miktar: k.miktar,
      birimFiyatKurus: u.satisFiyatiKurus,
      kdvOrani: u.kdvOrani,
      tutarKurus,
      partiler: fefoDagit(eldekiPartiler.get(k.barkod) ?? [], k.miktar, bugun, u.ad),
    };
  });
  return {
    odemeTuru: istek.odemeTuru,
    kalemler,
    toplamKurus: kalemler.reduce((t, k) => t + k.tutarKurus, 0),
    kdvKurus: kalemler.reduce((t, k) => t + icKdv(k.tutarKurus, k.kdvOrani), 0),
  };
}

export type StokUyarisi =
  | { tur: 'miadi-gecmis'; partiNo: string; skt: string; miktar: number }
  | { tur: 'miadi-yakin'; partiNo: string; skt: string; miktar: number; kalanGun: number }
  | { tur: 'kritik-stok'; miktar: number; kritikStok: number };

/** Son kullanma tarihine bu kadar gün kalan partiler için uyarı verilir. */
export const MIAD_UYARI_GUNU = 90;

const gunFarki = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

export function stokUyarilari(urun: Urun, eldekiler: Parti[], bugun: string): StokUyarisi[] {
  const u: StokUyarisi[] = [];
  for (const p of eldekiler) {
    if (miadiGecmis(p.skt, bugun)) u.push({ tur: 'miadi-gecmis', partiNo: p.partiNo, skt: p.skt, miktar: p.miktar });
    else {
      const kalanGun = gunFarki(bugun, p.skt);
      if (kalanGun <= MIAD_UYARI_GUNU) u.push({ tur: 'miadi-yakin', partiNo: p.partiNo, skt: p.skt, miktar: p.miktar, kalanGun });
    }
  }
  const miktar = eldekiler.reduce((t, p) => t + p.miktar, 0);
  if (urun.kritikStok !== undefined && miktar <= urun.kritikStok) u.push({ tur: 'kritik-stok', miktar, kritikStok: urun.kritikStok });
  return u;
}

export function urunDogrula(u: Partial<Urun>): string[] {
  const h: string[] = [];
  if (!u.barkod || !/^\d{8,14}$/.test(u.barkod)) h.push('Barkod 8-14 haneli rakam olmalı');
  if (!u.ad?.trim()) h.push('Ürün adı boş olamaz');
  if (!KDV_ORANLARI.includes(u.kdvOrani as KdvOrani)) h.push('KDV oranı 0, 1, 10 ya da 20 olmalı');
  if (!Number.isInteger(u.satisFiyatiKurus) || u.satisFiyatiKurus! < 0) h.push('Satış fiyatı kuruş cinsinden sıfır ya da pozitif tamsayı olmalı');
  if (u.kritikStok !== undefined && (!Number.isInteger(u.kritikStok) || u.kritikStok < 0)) h.push('Kritik stok sıfır ya da pozitif tamsayı olmalı');
  return h;
}
