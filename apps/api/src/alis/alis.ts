import { KDV_ORANLARI, type KdvOrani, type Parti, type Urun } from '../stok/stok.js';

// Ecza deposundan alış faturası. Fatura kaydedilince her satır stoğa parti olarak girer.
// Fiyatlar KDV hariç birim fiyattır (depo faturalarındaki gibi). Mal fazlası (MF) ücretsiz gelen adettir;
// stoğa girer ve birim maliyeti düşürür. Tutarlar kuruş cinsinden tamsayıdır.

export interface Tedarikci {
  id: string;
  ad: string;
  vergiNo?: string;
  telefon?: string;
}

export interface AlisKalemiIstegi {
  barkod: string;
  /** Kart yoksa zorunlu: kart bu adla açılır */
  ad?: string;
  miktar: number;
  malFazlasi?: number;
  partiNo: string;
  skt: string;
  birimFiyatKurus: number;
  kdvOrani: KdvOrani;
  iskontoYuzde?: number;
  /** Kart yoksa zorunlu: KDV dahil satış fiyatı */
  satisFiyatiKurus?: number;
}

export interface AlisKalemi extends AlisKalemiIstegi {
  ad: string;
  malFazlasi: number;
  iskontoYuzde: number;
  netKurus: number;
  kdvKurus: number;
  /** Stoğa giren her kutunun KDV hariç maliyeti (mal fazlası dahil dağıtılmış) */
  birimMaliyetKurus: number;
}

export interface AlisFaturasi {
  id: string;
  tedarikciId: string;
  tedarikciAd: string;
  faturaNo: string;
  tarih: string;
  kalemler: AlisKalemi[];
  netKurus: number;
  kdvKurus: number;
  toplamKurus: number;
  kaydeden: string;
  zaman: string;
}

export interface AlisFaturasiIstegi {
  tedarikciId: string;
  faturaNo: string;
  tarih: string;
  kalemler: AlisKalemiIstegi[];
}

const TARIH = /^\d{4}-\d{2}-\d{2}$/;
const tamsayi = (x: unknown, enAz = 0) => Number.isInteger(x) && (x as number) >= enAz;

export function faturaDogrula(f: Partial<AlisFaturasiIstegi> | undefined, kartlar: Map<string, Urun>, bugun: string): string[] {
  const h: string[] = [];
  if (!f?.tedarikciId) h.push('Tedarikçi seçin');
  if (!f?.faturaNo?.trim()) h.push('Fatura numarası gerekli');
  if (!f?.tarih || !TARIH.test(f.tarih)) h.push('Fatura tarihi YYYY-AA-GG olmalı');
  else if (f.tarih > bugun) h.push('Fatura tarihi ileri bir gün olamaz');
  if (!Array.isArray(f?.kalemler) || f.kalemler.length === 0) {
    h.push('Faturada en az bir satır olmalı');
    return h;
  }
  f.kalemler.forEach((k, i) => {
    const s = `${i + 1}. satır`;
    if (!k?.barkod || !/^\d{8,14}$/.test(k.barkod)) h.push(`${s}: barkod 8-14 haneli rakam olmalı`);
    if (!tamsayi(k?.miktar, 1)) h.push(`${s}: miktar 1 ya da daha büyük tamsayı olmalı`);
    if (k?.malFazlasi !== undefined && !tamsayi(k.malFazlasi)) h.push(`${s}: mal fazlası sıfır ya da pozitif tamsayı olmalı`);
    if (!k?.partiNo?.trim()) h.push(`${s}: parti numarası gerekli`);
    if (!k?.skt || !TARIH.test(k.skt)) h.push(`${s}: son kullanma tarihi YYYY-AA-GG olmalı`);
    else if (k.skt < bugun) h.push(`${s}: miadı geçmiş ürün stoğa alınamaz`);
    if (!tamsayi(k?.birimFiyatKurus)) h.push(`${s}: birim fiyat kuruş cinsinden sıfır ya da pozitif tamsayı olmalı`);
    if (!KDV_ORANLARI.includes(k?.kdvOrani)) h.push(`${s}: KDV oranı 0, 1, 10 ya da 20 olmalı`);
    if (k?.iskontoYuzde !== undefined && !(typeof k.iskontoYuzde === 'number' && k.iskontoYuzde >= 0 && k.iskontoYuzde < 100))
      h.push(`${s}: iskonto 0 ile 100 arasında olmalı`);
    if (k?.barkod && !kartlar.has(k.barkod)) {
      if (!k.ad?.trim()) h.push(`${s}: ürün kartı yok, ürün adını yazın`);
      if (!tamsayi(k.satisFiyatiKurus)) h.push(`${s}: ürün kartı yok, satış fiyatını yazın`);
    }
  });
  const barkodPartiler = f.kalemler.map((k) => `${k?.barkod}|${k?.partiNo}`);
  if (new Set(barkodPartiler).size !== barkodPartiler.length) h.push('Aynı ürünün aynı partisi faturada iki kez olamaz');
  return h;
}

/** Satır tutarlarını hesaplar. İskonto önce uygulanır, KDV iskontolu tutar üzerinden hesaplanır. */
export function kalemHesapla(k: AlisKalemiIstegi, ad: string): AlisKalemi {
  const malFazlasi = k.malFazlasi ?? 0;
  const iskontoYuzde = k.iskontoYuzde ?? 0;
  const netKurus = Math.round(k.miktar * k.birimFiyatKurus * (1 - iskontoYuzde / 100));
  return {
    ...k,
    ad,
    partiNo: k.partiNo.trim(),
    malFazlasi,
    iskontoYuzde,
    netKurus,
    kdvKurus: Math.round((netKurus * k.kdvOrani) / 100),
    birimMaliyetKurus: Math.round(netKurus / (k.miktar + malFazlasi)),
  };
}

export function faturaToplamlari(kalemler: AlisKalemi[]) {
  const netKurus = kalemler.reduce((t, k) => t + k.netKurus, 0);
  const kdvKurus = kalemler.reduce((t, k) => t + k.kdvKurus, 0);
  return { netKurus, kdvKurus, toplamKurus: netKurus + kdvKurus };
}

export interface SiparisOnerisi {
  urun: Urun;
  stok: number;
  oneri: number;
  sonTedarikci?: string;
  sonMaliyetKurus?: number;
}

/**
 * Kritik stoğa inmiş ürünler için sipariş önerisi. Öneri, stoğu kritik stoğun iki katına tamamlar.
 * Son alış bilgisi en yeni faturadan alınır.
 */
export function siparisOnerileri(urunler: Urun[], stok: Map<string, Parti[]>, faturalar: AlisFaturasi[]): SiparisOnerisi[] {
  const sonAlis = new Map<string, { tedarikci: string; maliyet: number; zaman: string }>();
  for (const f of faturalar)
    for (const k of f.kalemler) {
      const once = sonAlis.get(k.barkod);
      if (!once || once.zaman < f.zaman) sonAlis.set(k.barkod, { tedarikci: f.tedarikciAd, maliyet: k.birimMaliyetKurus, zaman: f.zaman });
    }
  return urunler
    .filter((u) => u.kritikStok !== undefined)
    .map((u) => {
      const miktar = (stok.get(u.barkod) ?? []).reduce((t, p) => t + p.miktar, 0);
      const son = sonAlis.get(u.barkod);
      return { urun: u, stok: miktar, oneri: Math.max(u.kritikStok! * 2 - miktar, 1), sonTedarikci: son?.tedarikci, sonMaliyetKurus: son?.maliyet };
    })
    .filter((o) => o.stok <= o.urun.kritikStok!)
    .sort((a, b) => a.stok - a.urun.kritikStok! - (b.stok - b.urun.kritikStok!));
}
