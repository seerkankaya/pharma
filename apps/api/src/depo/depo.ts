import type { AlisFaturasi, Tedarikci } from '../alis/alis.js';
import type { KdvOrani, Parti, StokHareketi, Urun } from '../stok/stok.js';

// Ecza deposuna iade ve depo carisi. Tutarlar kuruş cinsinden tamsayıdır.
// Depo carisi ayrı bir defter tutmaz: alış faturalarından (borç), iade faturalarından ve ödemelerden (alacak) hesaplanır.

export interface DepoIadeKalemiIstegi {
  barkod: string;
  partiNo: string;
  miktar: number;
  /** KDV hariç birim fiyat; verilmezse partinin alış maliyeti kullanılır */
  birimFiyatKurus?: number;
}

export interface DepoIadeKalemi extends Required<DepoIadeKalemiIstegi> {
  ad: string;
  skt: string;
  kdvOrani: KdvOrani;
  netKurus: number;
  kdvKurus: number;
}

export interface DepoIadesi {
  id: string;
  tedarikciId: string;
  tedarikciAd: string;
  /** Eczanenin kestiği iade faturasının numarası */
  belgeNo: string;
  tarih: string;
  neden: string;
  kalemler: DepoIadeKalemi[];
  netKurus: number;
  kdvKurus: number;
  toplamKurus: number;
  kaydeden: string;
  zaman: string;
}

export interface DepoIadeIstegi {
  tedarikciId: string;
  belgeNo: string;
  tarih: string;
  neden: string;
  kalemler: DepoIadeKalemiIstegi[];
}

export class DepoHatasi extends Error {}

const TARIH = /^\d{4}-\d{2}-\d{2}$/;
const tamsayi = (x: unknown, enAz = 0) => Number.isInteger(x) && (x as number) >= enAz;

export function iadeDogrula(i: Partial<DepoIadeIstegi> | undefined, bugun: string): string[] {
  const h: string[] = [];
  if (!i?.tedarikciId) h.push('İade edilecek depoyu seçin');
  if (!i?.belgeNo?.trim()) h.push('İade faturasının numarasını girin');
  if (!i?.tarih || !TARIH.test(i.tarih)) h.push('İade tarihi YYYY-AA-GG olmalı');
  else if (i.tarih > bugun) h.push('İade tarihi ileri bir gün olamaz');
  if (!i?.neden?.trim()) h.push('İade nedenini yazın');
  if (!Array.isArray(i?.kalemler) || i.kalemler.length === 0) {
    h.push('İadede en az bir satır olmalı');
    return h;
  }
  i.kalemler.forEach((k, n) => {
    const s = `${n + 1}. satır`;
    if (!k?.barkod || !/^\d{8,14}$/.test(k.barkod)) h.push(`${s}: barkod 8-14 haneli rakam olmalı`);
    if (!k?.partiNo?.trim()) h.push(`${s}: parti numarası gerekli`);
    if (!tamsayi(k?.miktar, 1)) h.push(`${s}: miktar 1 ya da daha büyük tamsayı olmalı`);
    if (k?.birimFiyatKurus !== undefined && !tamsayi(k.birimFiyatKurus)) h.push(`${s}: birim fiyat kuruş cinsinden sıfır ya da pozitif tamsayı olmalı`);
  });
  const anahtarlar = i.kalemler.map((k) => `${k?.barkod}|${k?.partiNo}`);
  if (new Set(anahtarlar).size !== anahtarlar.length) h.push('Aynı ürünün aynı partisi iadede iki kez olamaz');
  return h;
}

/** Partinin KDV hariç alış maliyeti: o partinin en son stok girişindeki birim maliyet. */
export function partiMaliyeti(girisler: StokHareketi[], barkod: string, partiNo: string): number | undefined {
  let son: StokHareketi | undefined;
  for (const g of girisler)
    if (g.barkod === barkod && g.partiNo === partiNo && g.birimMaliyetKurus !== undefined && (!son || g.zaman > son.zaman)) son = g;
  return son?.birimMaliyetKurus;
}

/**
 * İadeyi hazırlar: her satırın partisinde yeterli stok olduğunu denetler ve stoktan çıkış hareketlerini üretir.
 * Miadı geçmiş parti de iade edilebilir (miat iadesi). Yetersiz stokta DepoHatasi fırlatır.
 */
export function iadeHazirla(
  istek: DepoIadeIstegi,
  tedarikci: Tedarikci,
  urunler: Map<string, Urun>,
  eldekiler: Map<string, Parti[]>,
  girisler: StokHareketi[],
  bilgi: { id: string; kaydeden: string; kullaniciId: string; zaman: string },
): { iade: DepoIadesi; hareketler: StokHareketi[] } {
  const kalemler = istek.kalemler.map((k): DepoIadeKalemi => {
    const u = urunler.get(k.barkod);
    if (!u) throw new DepoHatasi(`${k.barkod} barkodlu ürünün kartı yok`);
    const partiNo = k.partiNo.trim();
    const p = (eldekiler.get(k.barkod) ?? []).find((x) => x.partiNo === partiNo);
    if (!p || p.miktar < k.miktar) throw new DepoHatasi(`${u.ad}: ${partiNo} partisinde ${p?.miktar ?? 0} adet var, ${k.miktar} adet iade edilemez`);
    const birimFiyatKurus = k.birimFiyatKurus ?? partiMaliyeti(girisler, k.barkod, partiNo) ?? 0;
    const netKurus = birimFiyatKurus * k.miktar;
    return {
      barkod: k.barkod,
      ad: u.ad,
      partiNo,
      skt: p.skt,
      miktar: k.miktar,
      birimFiyatKurus,
      kdvOrani: u.kdvOrani,
      netKurus,
      kdvKurus: Math.round((netKurus * u.kdvOrani) / 100),
    };
  });
  const netKurus = kalemler.reduce((t, k) => t + k.netKurus, 0);
  const kdvKurus = kalemler.reduce((t, k) => t + k.kdvKurus, 0);
  const iade: DepoIadesi = {
    id: bilgi.id,
    tedarikciId: tedarikci.id,
    tedarikciAd: tedarikci.ad,
    belgeNo: istek.belgeNo.trim(),
    tarih: istek.tarih,
    neden: istek.neden.trim(),
    kalemler,
    netKurus,
    kdvKurus,
    toplamKurus: netKurus + kdvKurus,
    kaydeden: bilgi.kaydeden,
    zaman: bilgi.zaman,
  };
  const hareketler = kalemler.map(
    (k): StokHareketi => ({
      barkod: k.barkod,
      tur: 'iade',
      miktar: -k.miktar,
      partiNo: k.partiNo,
      skt: k.skt,
      birimMaliyetKurus: k.birimFiyatKurus,
      aciklama: `Depo iadesi ${iade.belgeNo} (${tedarikci.ad})`,
      kullaniciId: bilgi.kullaniciId,
      zaman: bilgi.zaman,
    }),
  );
  return { iade, hareketler };
}

export type DepoOdemeTuru = 'nakit' | 'havale' | 'kart' | 'cek' | 'senet';
export const DEPO_ODEME_TURLERI: DepoOdemeTuru[] = ['nakit', 'havale', 'kart', 'cek', 'senet'];

export interface DepoOdemesi {
  id: string;
  tedarikciId: string;
  tutarKurus: number;
  odemeTuru: DepoOdemeTuru;
  tarih: string;
  /** Çek/senet numarası ya da havale açıklaması */
  belgeNo?: string;
  aciklama?: string;
  kaydeden: string;
  zaman: string;
}

export function odemeDogrula(o: Partial<DepoOdemesi> | undefined, bugun: string): string[] {
  const h: string[] = [];
  if (!tamsayi(o?.tutarKurus, 1)) h.push('Tutar pozitif olmalı');
  if (!DEPO_ODEME_TURLERI.includes(o?.odemeTuru as DepoOdemeTuru)) h.push(`Ödeme türü ${DEPO_ODEME_TURLERI.join(', ')} olmalı`);
  if (!o?.tarih || !TARIH.test(o.tarih)) h.push('Ödeme tarihi YYYY-AA-GG olmalı');
  else if (o.tarih > bugun) h.push('Ödeme tarihi ileri bir gün olamaz');
  return h;
}

export interface DepoCariHareketi {
  tarih: string;
  tur: 'fatura' | 'iade' | 'odeme';
  belgeNo?: string;
  aciklama: string;
  /** Depoya borcumuzu artıran tutar */
  borcKurus: number;
  /** Borcumuzu azaltan tutar */
  alacakKurus: number;
  /** Bu hareketten sonra depoya borcumuz (eksi ise depo bize borçlu) */
  bakiyeKurus: number;
  zaman: string;
}

/** Bir deponun cari hesap dökümü, eskiden yeniye. */
export function depoCarisi(tedarikciId: string, faturalar: AlisFaturasi[], iadeler: DepoIadesi[], odemeler: DepoOdemesi[]): DepoCariHareketi[] {
  const satirlar: Omit<DepoCariHareketi, 'bakiyeKurus'>[] = [
    ...faturalar
      .filter((f) => f.tedarikciId === tedarikciId)
      .map((f) => ({ tarih: f.tarih, tur: 'fatura' as const, belgeNo: f.faturaNo, aciklama: 'Alış faturası', borcKurus: f.toplamKurus, alacakKurus: 0, zaman: f.zaman })),
    ...iadeler
      .filter((i) => i.tedarikciId === tedarikciId)
      .map((i) => ({ tarih: i.tarih, tur: 'iade' as const, belgeNo: i.belgeNo, aciklama: `İade: ${i.neden}`, borcKurus: 0, alacakKurus: i.toplamKurus, zaman: i.zaman })),
    ...odemeler
      .filter((o) => o.tedarikciId === tedarikciId)
      .map((o) => ({
        tarih: o.tarih,
        tur: 'odeme' as const,
        ...(o.belgeNo ? { belgeNo: o.belgeNo } : {}),
        aciklama: `Ödeme (${o.odemeTuru})${o.aciklama ? `: ${o.aciklama}` : ''}`,
        borcKurus: 0,
        alacakKurus: o.tutarKurus,
        zaman: o.zaman,
      })),
  ].sort((a, b) => a.tarih.localeCompare(b.tarih) || a.zaman.localeCompare(b.zaman));
  let bakiye = 0;
  return satirlar.map((s) => ({ ...s, bakiyeKurus: (bakiye += s.borcKurus - s.alacakKurus) }));
}
