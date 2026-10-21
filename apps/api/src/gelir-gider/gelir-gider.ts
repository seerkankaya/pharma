// Gelir-gider (ön muhasebe). Satış ve veresiye tahsilatı dışındaki para hareketleri burada tutulur:
// kira, personel, fatura giderleri, diğer gelirler. Kayıtlar silinmez ve değiştirilmez; yanlış kayıt,
// onu iptal eden yeni bir kayıtla düzeltilir. Nakit kayıtlar günün kasa beklentisine girer.

export type KasaHareketTuru = 'gelir' | 'gider';
export type KasaOdemeTuru = 'nakit' | 'kart' | 'havale';
export const KASA_ODEME_TURLERI: KasaOdemeTuru[] = ['nakit', 'kart', 'havale'];

export const GIDER_KATEGORILERI = [
  'kira',
  'personel',
  'elektrik-su-dogalgaz',
  'telefon-internet',
  'vergi-sgk',
  'muhasebe',
  'kirtasiye-sarf',
  'temizlik',
  'banka-masrafi',
  'bakim-onarim',
  'diger',
] as const;
export const GELIR_KATEGORILERI = ['faiz', 'kira-geliri', 'hizmet', 'diger'] as const;

export interface KasaHareketi {
  id: string;
  tur: KasaHareketTuru;
  kategori: string;
  tutarKurus: number;
  odemeTuru: KasaOdemeTuru;
  /** Paranın kasaya girdiği ya da çıktığı gün (YYYY-AA-GG) */
  tarih: string;
  aciklama?: string;
  belgeNo?: string;
  /** Bu kayıt başka bir kaydı iptal ediyorsa onun kimliği */
  iptalEdilenId?: string;
  kullaniciId: string;
  kaydeden: string;
  zaman: string;
}

export type KasaHareketIstegi = Pick<KasaHareketi, 'tur' | 'kategori' | 'tutarKurus' | 'odemeTuru' | 'tarih' | 'aciklama' | 'belgeNo'>;

const TARIH = /^\d{4}-\d{2}-\d{2}$/;

export function hareketDogrula(h: Partial<KasaHareketIstegi> | undefined, bugun: string): string[] {
  const e: string[] = [];
  if (h?.tur !== 'gelir' && h?.tur !== 'gider') e.push('Tür gelir ya da gider olmalı');
  else {
    const kategoriler: readonly string[] = h.tur === 'gider' ? GIDER_KATEGORILERI : GELIR_KATEGORILERI;
    if (!kategoriler.includes(h.kategori ?? '')) e.push(`Kategori şunlardan biri olmalı: ${kategoriler.join(', ')}`);
    else if (h.kategori === 'diger' && !h.aciklama?.trim()) e.push('"Diğer" kategorisinde açıklama yazın');
  }
  if (!Number.isInteger(h?.tutarKurus) || h!.tutarKurus! <= 0) e.push('Tutar pozitif olmalı');
  if (!KASA_ODEME_TURLERI.includes(h?.odemeTuru as KasaOdemeTuru)) e.push('Ödeme türü nakit, kart ya da havale olmalı');
  if (!h?.tarih || !TARIH.test(h.tarih)) e.push('Tarih YYYY-AA-GG olmalı');
  else if (h.tarih > bugun) e.push('Tarih ileri bir gün olamaz');
  return e;
}

/** İptal edilmiş kayıtlar ve iptal kayıtları çıkarılmış, etkisi süren kayıtlar. */
export function gecerliHareketler(hareketler: KasaHareketi[]): KasaHareketi[] {
  const iptaller = new Set(hareketler.filter((h) => h.iptalEdilenId).map((h) => h.iptalEdilenId));
  return hareketler.filter((h) => !h.iptalEdilenId && !iptaller.has(h.id));
}

/** Kasaya giren ve çıkan nakit, POS'a giren kart. Diğer modüllerin (depo ödemesi gibi) nakit çıkışları da buraya eklenir. */
export interface KasaEtkisi {
  nakitGelirKurus: number;
  nakitGiderKurus: number;
  kartGelirKurus: number;
}

export function kasaEtkisi(hareketler: Pick<KasaHareketi, 'tur' | 'tutarKurus' | 'odemeTuru'>[]): KasaEtkisi {
  const topla = (tur: KasaHareketTuru, odeme: KasaOdemeTuru) =>
    hareketler.filter((h) => h.tur === tur && h.odemeTuru === odeme).reduce((t, h) => t + h.tutarKurus, 0);
  return { nakitGelirKurus: topla('gelir', 'nakit'), nakitGiderKurus: topla('gider', 'nakit'), kartGelirKurus: topla('gelir', 'kart') };
}

export interface GelirGiderOzeti {
  gelirKurus: number;
  giderKurus: number;
  netKurus: number;
  kategoriler: { tur: KasaHareketTuru; kategori: string; tutarKurus: number; adet: number }[];
}

export function gelirGiderOzeti(hareketler: KasaHareketi[]): GelirGiderOzeti {
  const m = new Map<string, GelirGiderOzeti['kategoriler'][number]>();
  for (const h of gecerliHareketler(hareketler)) {
    const a = `${h.tur}|${h.kategori}`;
    const s = m.get(a) ?? { tur: h.tur, kategori: h.kategori, tutarKurus: 0, adet: 0 };
    s.tutarKurus += h.tutarKurus;
    s.adet++;
    m.set(a, s);
  }
  const kategoriler = [...m.values()].sort((a, b) => a.tur.localeCompare(b.tur) || b.tutarKurus - a.tutarKurus);
  const gelirKurus = kategoriler.filter((k) => k.tur === 'gelir').reduce((t, k) => t + k.tutarKurus, 0);
  const giderKurus = kategoriler.filter((k) => k.tur === 'gider').reduce((t, k) => t + k.tutarKurus, 0);
  return { gelirKurus, giderKurus, netKurus: gelirKurus - giderKurus, kategoriler };
}
