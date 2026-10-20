import type { AlisFaturasi, Tedarikci } from '../alis/alis.js';
import { BellekCariDefteri, type CariBorc } from '../cari/cari.js';
import type { Parti, Satis, StokHareketi, Urun } from './stok.js';
import { partiler, StokHatasi } from './stok.js';

export class FaturaZatenVarHatasi extends StokHatasi {
  constructor(faturaNo: string) {
    super(`${faturaNo} numaralı fatura bu tedarikçiden zaten girilmiş`);
  }
}

/** Bir stok işleminin yazacakları. */
export interface StokYazimi<T> {
  sonuc: T;
  hareketler?: StokHareketi[];
  satis?: Satis;
  fatura?: AlisFaturasi;
  /** İşlemle birlikte açılacak ürün kartları (faturada kartı olmayan ürünler) */
  yeniUrunler?: Urun[];
  /** Veresiye satışın borcu; limit aşılırsa işlemin tamamı geri alınır */
  cariBorc?: CariBorc;
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
  /** Tüm stok giriş hareketleri; parti maliyetleri buradan hesaplanır. */
  girisler(eczaneId: string): Promise<StokHareketi[]>;
  /** [baslangic, bitis) aralığındaki satışlar, en yenisi önce. */
  satislar(eczaneId: string, baslangic: Date, bitis: Date): Promise<Satis[]>;
  tedarikciler(eczaneId: string): Promise<Tedarikci[]>;
  tedarikciEkle(eczaneId: string, t: Omit<Tedarikci, 'id'>): Promise<Tedarikci>;
  /** Alış faturaları, en yenisi önce. */
  faturalar(eczaneId: string): Promise<AlisFaturasi[]>;
}

export class BellekStokDeposu implements StokDeposu {
  constructor(private readonly cari = new BellekCariDefteri()) {}

  private urunMap = new Map<string, Map<string, Urun>>();
  private hareketler: (StokHareketi & { eczaneId: string })[] = [];
  private satisListesi: (Satis & { eczaneId: string })[] = [];
  private tedarikciListesi: (Tedarikci & { eczaneId: string })[] = [];
  private faturaListesi: (AlisFaturasi & { eczaneId: string })[] = [];
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
      if (y.cariBorc) this.cari.borcYaz(eczaneId, y.cariBorc);
      if (y.fatura) {
        const { tedarikciId, faturaNo } = y.fatura;
        if (this.faturaListesi.some((x) => x.eczaneId === eczaneId && x.tedarikciId === tedarikciId && x.faturaNo === faturaNo))
          throw new FaturaZatenVarHatasi(faturaNo);
        this.faturaListesi.push(structuredClone({ ...y.fatura, eczaneId }));
      }
      for (const u of y.yeniUrunler ?? []) void this.urunKaydet(eczaneId, u);
      if (y.satis) this.satisListesi.push(structuredClone({ ...y.satis, eczaneId }));
      for (const h of y.hareketler ?? []) this.hareketler.push({ ...h, eczaneId });
      return y.sonuc;
    });
    this.sira = sonuc.catch(() => undefined);
    return sonuc;
  }

  async girisler(eczaneId: string) {
    return this.hareketler.filter((h) => h.eczaneId === eczaneId && h.tur === 'giris').map(({ eczaneId: _e, ...h }) => ({ ...h }));
  }

  async satislar(eczaneId: string, baslangic: Date, bitis: Date) {
    return this.satisListesi
      .filter((s) => s.eczaneId === eczaneId && new Date(s.zaman) >= baslangic && new Date(s.zaman) < bitis)
      .map(({ eczaneId: _e, ...s }) => structuredClone(s))
      .reverse();
  }

  async tedarikciler(eczaneId: string) {
    return this.tedarikciListesi.filter((t) => t.eczaneId === eczaneId).map(({ eczaneId: _e, ...t }) => t);
  }

  async tedarikciEkle(eczaneId: string, t: Omit<Tedarikci, 'id'>) {
    const yeni = { ...t, id: crypto.randomUUID() };
    this.tedarikciListesi.push({ ...yeni, eczaneId });
    return yeni;
  }

  async faturalar(eczaneId: string) {
    return this.faturaListesi
      .filter((f) => f.eczaneId === eczaneId)
      .map(({ eczaneId: _e, ...f }) => structuredClone(f))
      .reverse();
  }
}
