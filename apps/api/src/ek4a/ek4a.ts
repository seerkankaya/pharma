import { haritaListesi, normalize, type Ek4aKaydi, type Ek4aListesi } from '@scalpiq/sut-motoru';

// EK-4/A listesinin yüklenen sürümleri. Kontrol her zaman en son yayımlanan sürümle yapılır.

export interface Ek4aSatiri extends Ek4aKaydi {
  eskiBarkodlar: string[];
}

export interface Ek4aSurumu {
  id: string;
  yayimTarihi: string;
  dosyaAdi?: string;
  yukleyen: string;
  zaman: string;
  kayitSayisi: number;
}

export interface Ek4aDeposu {
  /** En son yayım tarihli sürüm ve kayıtları; hiç yükleme yoksa undefined. */
  aktif(): Promise<{ surum: Ek4aSurumu; kayitlar: Ek4aSatiri[] } | undefined>;
  ekle(s: Omit<Ek4aSurumu, 'id' | 'zaman' | 'kayitSayisi'> & { kullaniciId: string }, kayitlar: Ek4aSatiri[]): Promise<Ek4aSurumu>;
  /** Yüklenen sürümler, en yenisi önce. */
  surumler(): Promise<Ek4aSurumu[]>;
}

/** Aynı barkod dosyada iki kez geçerse ilki alınır. */
export function tekillestir(kayitlar: Ek4aSatiri[]): { kayitlar: Ek4aSatiri[]; tekrarlar: string[] } {
  const gorulen = new Set<string>();
  const tekrarlar: string[] = [];
  const sonuc = kayitlar.filter((k) => {
    if (gorulen.has(k.barkod)) {
      tekrarlar.push(k.barkod);
      return false;
    }
    gorulen.add(k.barkod);
    return true;
  });
  return { kayitlar: sonuc, tekrarlar };
}

/**
 * Kontrol motoruna verilen EK-4/A. Yeni sürüm yüklenince sunucu yeniden başlatılmadan değişir.
 * Ekranda arama için kayıtları da tutar.
 */
export class DegisenEk4a implements Ek4aListesi {
  private liste: Ek4aListesi;
  private kayitlar: Ek4aKaydi[];
  surum: Ek4aSurumu | undefined;

  constructor(baslangic: Ek4aListesi, kayitlar: Ek4aKaydi[] = [], surum?: Ek4aSurumu) {
    this.liste = baslangic;
    this.kayitlar = kayitlar;
    this.surum = surum;
  }

  get yayimTarihi() {
    return this.liste.yayimTarihi;
  }

  bul(barkod: string) {
    return this.liste.bul(barkod);
  }

  degistir(surum: Ek4aSurumu, kayitlar: Ek4aSatiri[]) {
    this.liste = haritaListesi(surum.yayimTarihi, kayitlar);
    this.kayitlar = kayitlar;
    this.surum = surum;
  }

  /** Barkod ya da ad parçasıyla arar. */
  ara(metin: string, adet = 20): Ek4aKaydi[] {
    // Türkçe harfler sadeleştirilir: "yenikor" da "YENİKOR" da "YENIKOR"u bulur.
    const m = normalize(metin);
    if (m.length < 3) return [];
    if (/^\d+$/.test(m)) {
      const tam = this.bul(m);
      return tam ? [tam] : this.kayitlar.filter((k) => k.barkod.startsWith(m)).slice(0, adet);
    }
    return this.kayitlar.filter((k) => normalize(k.ad).includes(m)).slice(0, adet);
  }

  get kayitSayisi() {
    return this.kayitlar.length;
  }
}

export class BellekEk4aDeposu implements Ek4aDeposu {
  private liste: { surum: Ek4aSurumu; kayitlar: Ek4aSatiri[] }[] = [];

  async aktif() {
    return structuredClone(
      [...this.liste].sort((a, b) => b.surum.yayimTarihi.localeCompare(a.surum.yayimTarihi) || b.surum.zaman.localeCompare(a.surum.zaman))[0],
    );
  }

  async ekle(s: Omit<Ek4aSurumu, 'id' | 'zaman' | 'kayitSayisi'> & { kullaniciId: string }, kayitlar: Ek4aSatiri[]) {
    const { kullaniciId: _k, ...bilgi } = s;
    const surum: Ek4aSurumu = { ...bilgi, id: crypto.randomUUID(), zaman: new Date().toISOString(), kayitSayisi: kayitlar.length };
    this.liste.push(structuredClone({ surum, kayitlar }));
    return surum;
  }

  async surumler() {
    return this.liste.map((x) => x.surum).sort((a, b) => b.yayimTarihi.localeCompare(a.yayimTarihi) || b.zaman.localeCompare(a.zaman));
  }
}
