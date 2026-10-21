import { fefoDagit, type Parti, type StokHareketi, type Urun } from '../stok/stok.js';

// Emanet ilaç takibi. Dört tür emanet vardır:
// - verilen: ilaç hastaya reçetesi sonra getirilmek üzere verildi (stok verilirken düşer)
// - bekleyen: hastanın ilacı eczanede eksik, sonra teslim edilecek (stok teslimde düşer)
// - eczaneden-alinan: başka eczaneden ödünç alındı (stok alırken girer)
// - eczaneye-verilen: başka eczaneye ödünç verildi (stok verirken düşer)
// Emanet kapanana kadar açık listede görünür. Stok hareketleri emanet belgesiyle aynı işlemde yazılır.

export type EmanetTuru = 'verilen' | 'bekleyen' | 'eczaneden-alinan' | 'eczaneye-verilen';
export const EMANET_TURLERI: EmanetTuru[] = ['verilen', 'bekleyen', 'eczaneden-alinan', 'eczaneye-verilen'];
export type KapanisSekli = 'recete' | 'teslim' | 'iade' | 'odeme' | 'iptal';
export type EmanetDurumu = 'acik' | 'kapaniyor' | 'kapandi';

/** Her emanet türünün hangi şekillerde kapanabileceği. */
export const KAPANIS_SEKILLERI: Record<EmanetTuru, KapanisSekli[]> = {
  verilen: ['recete', 'iade'],
  bekleyen: ['teslim', 'iptal'],
  'eczaneden-alinan': ['iade', 'odeme'],
  'eczaneye-verilen': ['iade', 'odeme'],
};

export interface EmanetKalemi {
  barkod: string;
  ad: string;
  miktar: number;
  /** Stoğa giren ya da stoktan çıkan partiler */
  partiler: Parti[];
}

export interface EmanetKapanisi {
  sekil: KapanisSekli;
  receteNo?: string;
  not?: string;
  kaydeden: string;
  zaman: string;
}

export interface Emanet {
  id: string;
  tur: EmanetTuru;
  /** Hasta ya da karşı eczane */
  kisiAd: string;
  telefon?: string;
  /** Veresiye müşteri kaydı varsa */
  musteriId?: string;
  kalemler: EmanetKalemi[];
  beklenenTarih?: string;
  aciklama?: string;
  durum: EmanetDurumu;
  kapanis?: EmanetKapanisi;
  kaydeden: string;
  zaman: string;
}

export interface EmanetKalemIstegi {
  barkod: string;
  miktar: number;
  /** Yalnızca başka eczaneden alınan emanette: gelen kutunun partisi ve son kullanma tarihi */
  partiNo?: string;
  skt?: string;
}

export interface EmanetIstegi {
  tur: EmanetTuru;
  kisiAd: string;
  telefon?: string;
  musteriId?: string;
  kalemler: EmanetKalemIstegi[];
  beklenenTarih?: string;
  aciklama?: string;
}

export class EmanetHatasi extends Error {}

const TARIH = /^\d{4}-\d{2}-\d{2}$/;

export function emanetDogrula(i: Partial<EmanetIstegi> | undefined, bugun: string): string[] {
  const h: string[] = [];
  if (!EMANET_TURLERI.includes(i?.tur as EmanetTuru)) h.push(`Emanet türü ${EMANET_TURLERI.join(', ')} olmalı`);
  const eczane = i?.tur === 'eczaneden-alinan' || i?.tur === 'eczaneye-verilen';
  if (!i?.kisiAd?.trim()) h.push(eczane ? 'Karşı eczanenin adını yazın' : 'Hastanın adını yazın');
  if (i?.beklenenTarih !== undefined && !TARIH.test(i.beklenenTarih)) h.push('Beklenen tarih YYYY-AA-GG olmalı');
  if (!Array.isArray(i?.kalemler) || i.kalemler.length === 0) {
    h.push('En az bir ilaç girin');
    return h;
  }
  i.kalemler.forEach((k, n) => {
    const s = `${n + 1}. satır`;
    if (!k?.barkod || !/^\d{8,14}$/.test(k.barkod)) h.push(`${s}: barkod 8-14 haneli rakam olmalı`);
    if (!Number.isInteger(k?.miktar) || k.miktar < 1) h.push(`${s}: miktar 1 ya da daha büyük tamsayı olmalı`);
    if (i.tur === 'eczaneden-alinan') {
      if (!k?.partiNo?.trim()) h.push(`${s}: gelen kutunun parti numarasını girin`);
      if (!k?.skt || !TARIH.test(k.skt)) h.push(`${s}: son kullanma tarihi YYYY-AA-GG olmalı`);
      else if (k.skt < bugun) h.push(`${s}: miadı geçmiş ürün stoğa alınamaz`);
    }
  });
  if (new Set(i.kalemler.map((k) => k?.barkod)).size !== i.kalemler.length) h.push('Aynı ilaç iki kez girilmiş; miktarını artırın');
  return h;
}

interface Bilgi {
  kullaniciId: string;
  kaydeden: string;
  zaman: string;
  bugun: string;
}

function cikis(barkod: string, partiler: Parti[], aciklama: string, b: Bilgi): StokHareketi[] {
  return partiler.map((p) => ({ barkod, tur: 'emanet', miktar: -p.miktar, partiNo: p.partiNo, skt: p.skt, aciklama, kullaniciId: b.kullaniciId, zaman: b.zaman }));
}

function giris(barkod: string, partiler: Parti[], aciklama: string, b: Bilgi): StokHareketi[] {
  return partiler.map((p) => ({ barkod, tur: 'giris', miktar: p.miktar, partiNo: p.partiNo, skt: p.skt, aciklama, kullaniciId: b.kullaniciId, zaman: b.zaman }));
}

const etiket = (e: Pick<Emanet, 'tur' | 'kisiAd'>) => `Emanet (${e.tur}): ${e.kisiAd}`;

/** Emaneti açar ve türüne göre stok hareketlerini üretir. Stok yetmezse StokHatasi fırlatır. */
export function emanetAc(
  istek: EmanetIstegi,
  urunler: Map<string, Urun>,
  eldekiler: Map<string, Parti[]>,
  b: Bilgi & { id: string },
): { emanet: Emanet; hareketler: StokHareketi[] } {
  const emanetTaslagi = { tur: istek.tur, kisiAd: istek.kisiAd.trim() };
  const hareketler: StokHareketi[] = [];
  const kalemler = istek.kalemler.map((k): EmanetKalemi => {
    const u = urunler.get(k.barkod);
    if (!u) throw new EmanetHatasi(`${k.barkod} barkodlu ürünün kartı yok`);
    let partiler: Parti[] = [];
    if (istek.tur === 'eczaneden-alinan') {
      partiler = [{ partiNo: k.partiNo!.trim(), skt: k.skt!, miktar: k.miktar }];
      hareketler.push(...giris(k.barkod, partiler, etiket(emanetTaslagi), b));
    } else if (istek.tur === 'verilen' || istek.tur === 'eczaneye-verilen') {
      partiler = fefoDagit(eldekiler.get(k.barkod) ?? [], k.miktar, b.bugun, u.ad);
      hareketler.push(...cikis(k.barkod, partiler, etiket(emanetTaslagi), b));
    }
    return { barkod: k.barkod, ad: u.ad, miktar: k.miktar, partiler };
  });
  return {
    emanet: {
      id: b.id,
      ...emanetTaslagi,
      ...(istek.telefon?.trim() ? { telefon: istek.telefon.trim() } : {}),
      ...(istek.musteriId ? { musteriId: istek.musteriId } : {}),
      kalemler,
      ...(istek.beklenenTarih ? { beklenenTarih: istek.beklenenTarih } : {}),
      ...(istek.aciklama?.trim() ? { aciklama: istek.aciklama.trim() } : {}),
      durum: 'acik',
      kaydeden: b.kaydeden,
      zaman: b.zaman,
    },
    hareketler,
  };
}

/** Emanet kapanırken gereken stok hareketlerini üretir; kapanış şekli emanet türüne uymazsa EmanetHatasi fırlatır. */
export function kapanisHareketleri(e: Emanet, sekil: KapanisSekli, eldekiler: Map<string, Parti[]>, b: Bilgi): { emanet: Emanet; hareketler: StokHareketi[] } {
  if (!KAPANIS_SEKILLERI[e.tur].includes(sekil)) throw new EmanetHatasi(`Bu emanet ${KAPANIS_SEKILLERI[e.tur].join(' ya da ')} ile kapanır`);
  const aciklama = `${etiket(e)} kapanışı (${sekil})`;
  const hareketler: StokHareketi[] = [];
  const kalemler = e.kalemler.map((k) => {
    // Hastaya teslim ve ödünç alınanın iadesi stoktan düşer; verilenin geri gelmesi aynı partilerle stoğa girer.
    if ((e.tur === 'bekleyen' && sekil === 'teslim') || (e.tur === 'eczaneden-alinan' && sekil === 'iade')) {
      const partiler = fefoDagit(eldekiler.get(k.barkod) ?? [], k.miktar, b.bugun, k.ad);
      hareketler.push(...cikis(k.barkod, partiler, aciklama, b));
      return e.tur === 'bekleyen' ? { ...k, partiler } : k;
    }
    if ((e.tur === 'verilen' || e.tur === 'eczaneye-verilen') && sekil === 'iade') hareketler.push(...giris(k.barkod, k.partiler, aciklama, b));
    return k;
  });
  return { emanet: { ...e, kalemler }, hareketler };
}

/** Takılı kalmış kapanış 5 dakika sonra yeniden denenebilir. */
export const kapatilabilirMi = (e: Emanet, simdi: Date) =>
  e.durum === 'acik' || (e.durum === 'kapaniyor' && simdi.getTime() - Date.parse(e.kapanis?.zaman ?? e.zaman) > 5 * 60_000);
