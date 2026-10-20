import type { Parti, Satis, StokHareketi, Urun } from './stok.js';
import { partiler } from './stok.js';

/** Bir stok işleminin yazacakları. */
export interface StokYazimi<T> {
  sonuc: T;
  hareketler?: StokHareketi[];
  satis?: Satis;
}

export interface StokDeposu {
  urunler(eczaneId: string): Promise<Urun[]>;
  urunKaydet(eczaneId: string, urun: Urun): Promise<void>;
  /** Eczanenin elindeki partiler, barkoda göre. */
  stok(eczaneId: string): Promise<Map<string, Parti[]>>;
  /**
   * Verilen barkodların partilerini okuyup işlemi yürütür ve sonucunu yazar.
   * Aynı ürünlere dokunan işlemler sırayla yürür; iki kasa aynı son kutuyu birlikte satamaz.
   * İşlem hata fırlatırsa hiçbir şey yazılmaz.
   */
  islem<T>(eczaneId: string, barkodlar: string[], f: (partiler: Map<string, Parti[]>) => StokYazimi<T>): Promise<T>;
  /** [baslangic, bitis) aralığındaki satışlar, en yenisi önce. */
  satislar(eczaneId: string, baslangic: Date, bitis: Date): Promise<Satis[]>;
}

export class BellekStokDeposu implements StokDeposu {
  private urunMap = new Map<string, Map<string, Urun>>();
  private hareketler: (StokHareketi & { eczaneId: string })[] = [];
  private satisListesi: (Satis & { eczaneId: string })[] = [];
  private sira: Promise<unknown> = Promise.resolve();

  async urunler(eczaneId: string) {
    return [...(this.urunMap.get(eczaneId)?.values() ?? [])].map((u) => ({ ...u }));
  }

  async urunKaydet(eczaneId: string, urun: Urun) {
    if (!this.urunMap.has(eczaneId)) this.urunMap.set(eczaneId, new Map());
    this.urunMap.get(eczaneId)!.set(urun.barkod, { ...urun });
  }

  private partiHaritasi(eczaneId: string, barkodlar?: string[]) {
    const m = new Map<string, Parti[]>();
    const secili = this.hareketler.filter((h) => h.eczaneId === eczaneId && (!barkodlar || barkodlar.includes(h.barkod)));
    for (const b of new Set(secili.map((h) => h.barkod))) m.set(b, partiler(secili.filter((h) => h.barkod === b)));
    return m;
  }

  async stok(eczaneId: string) {
    return this.partiHaritasi(eczaneId);
  }

  islem<T>(eczaneId: string, barkodlar: string[], f: (partiler: Map<string, Parti[]>) => StokYazimi<T>): Promise<T> {
    const sonuc = this.sira.then(() => {
      const y = f(this.partiHaritasi(eczaneId, barkodlar));
      if (y.satis) this.satisListesi.push(structuredClone({ ...y.satis, eczaneId }));
      for (const h of y.hareketler ?? []) this.hareketler.push({ ...h, eczaneId });
      return y.sonuc;
    });
    this.sira = sonuc.catch(() => undefined);
    return sonuc;
  }

  async satislar(eczaneId: string, baslangic: Date, bitis: Date) {
    return this.satisListesi
      .filter((s) => s.eczaneId === eczaneId && new Date(s.zaman) >= baslangic && new Date(s.zaman) < bitis)
      .map(({ eczaneId: _e, ...s }) => structuredClone(s))
      .reverse();
  }
}
