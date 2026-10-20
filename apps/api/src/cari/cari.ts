import { randomUUID } from 'node:crypto';
import { StokHatasi } from '../stok/stok.js';

// Veresiye (cari hesap). Müşterinin borcu yalnızca eklenen hareketlerden hesaplanır:
// veresiye satış borç yazar, tahsilat borcu düşer. Hareketler silinmez ve değiştirilmez.
// Tutarlar kuruş cinsinden tamsayıdır.

export interface Musteri {
  id: string;
  adSoyad: string;
  telefon?: string;
  /** Bu tutarı aşan veresiye satış yapılamaz; boşsa sınır yok */
  limitKurus?: number;
  not?: string;
}

export interface CariHareket {
  musteriId: string;
  tur: 'borc' | 'tahsilat';
  /** Her zaman pozitif; yönü türden gelir */
  tutarKurus: number;
  satisId?: string;
  odemeTuru?: 'nakit' | 'kart';
  aciklama?: string;
  kullaniciId: string;
  kaydeden: string;
  zaman: string;
}

/** Veresiye satışla birlikte yazılacak borç ve uygulanacak limit. */
export interface CariBorc {
  hareket: CariHareket;
  limitKurus?: number;
  musteriAd: string;
}

export const bakiye = (hareketler: Pick<CariHareket, 'tur' | 'tutarKurus'>[]) =>
  hareketler.reduce((t, h) => t + (h.tur === 'borc' ? h.tutarKurus : -h.tutarKurus), 0);

/** Limit aşılıyorsa StokHatasi fırlatır; satışla aynı işlemde çağrılır, satış da yazılmaz. */
export function limitDenetle(mevcutBakiye: number, borc: CariBorc) {
  if (borc.limitKurus !== undefined && mevcutBakiye + borc.hareket.tutarKurus > borc.limitKurus) {
    const tl = (k: number) => (k / 100).toLocaleString('tr-TR', { style: 'currency', currency: 'TRY' });
    throw new StokHatasi(`${borc.musteriAd}: veresiye limiti ${tl(borc.limitKurus)}, mevcut borç ${tl(mevcutBakiye)}. Bu satışla limit aşılıyor.`);
  }
}

export class CariHatasi extends Error {}

export function musteriDogrula(m: Partial<Musteri>): string[] {
  const h: string[] = [];
  if (!m.adSoyad?.trim()) h.push('Ad soyad boş olamaz');
  if (m.telefon && !/^[0-9 +()-]{10,20}$/.test(m.telefon)) h.push('Telefon numarası geçersiz');
  if (m.limitKurus !== undefined && (!Number.isInteger(m.limitKurus) || m.limitKurus < 0)) h.push('Limit sıfır ya da pozitif tamsayı (kuruş) olmalı');
  return h;
}

export interface CariDeposu {
  musteriler(eczaneId: string): Promise<(Musteri & { bakiyeKurus: number })[]>;
  musteriAl(eczaneId: string, id: string): Promise<Musteri | undefined>;
  musteriEkle(eczaneId: string, m: Omit<Musteri, 'id'>): Promise<Musteri>;
  /** Müşterinin hareketleri, en yenisi önce. */
  hareketler(eczaneId: string, musteriId: string): Promise<CariHareket[]>;
  /** Borçtan fazla tahsilat yapılamaz; kontrol ve yazım aynı kilit altında yürür. */
  tahsilat(eczaneId: string, h: CariHareket): Promise<number>;
}

/** Bellek deposunun stok deposuyla paylaştığı defter; veresiye satış borcu buraya yazılır. */
export class BellekCariDefteri {
  musteriler: (Musteri & { eczaneId: string })[] = [];
  hareketler: (CariHareket & { eczaneId: string })[] = [];

  bakiye(eczaneId: string, musteriId: string) {
    return bakiye(this.hareketler.filter((h) => h.eczaneId === eczaneId && h.musteriId === musteriId));
  }

  borcYaz(eczaneId: string, borc: CariBorc) {
    limitDenetle(this.bakiye(eczaneId, borc.hareket.musteriId), borc);
    this.hareketler.push({ ...borc.hareket, eczaneId });
  }
}

export class BellekCariDeposu implements CariDeposu {
  constructor(readonly defter = new BellekCariDefteri()) {}

  async musteriler(eczaneId: string) {
    return this.defter.musteriler
      .filter((m) => m.eczaneId === eczaneId)
      .map(({ eczaneId: _e, ...m }) => ({ ...m, bakiyeKurus: this.defter.bakiye(eczaneId, m.id) }))
      .sort((a, b) => a.adSoyad.localeCompare(b.adSoyad, 'tr'));
  }

  async musteriAl(eczaneId: string, id: string) {
    const m = this.defter.musteriler.find((x) => x.eczaneId === eczaneId && x.id === id);
    if (!m) return undefined;
    const { eczaneId: _e, ...kalan } = m;
    return kalan;
  }

  async musteriEkle(eczaneId: string, m: Omit<Musteri, 'id'>) {
    const yeni = { ...m, id: randomUUID() };
    this.defter.musteriler.push({ ...yeni, eczaneId });
    return yeni;
  }

  async hareketler(eczaneId: string, musteriId: string) {
    return this.defter.hareketler
      .filter((h) => h.eczaneId === eczaneId && h.musteriId === musteriId)
      .map(({ eczaneId: _e, ...h }) => h)
      .reverse();
  }

  async tahsilat(eczaneId: string, h: CariHareket) {
    const once = this.defter.bakiye(eczaneId, h.musteriId);
    if (h.tutarKurus > once) throw new CariHatasi(`Tahsilat borçtan fazla olamaz (borç ${(once / 100).toFixed(2)} TL)`);
    this.defter.hareketler.push({ ...h, eczaneId });
    return once - h.tutarKurus;
  }
}
