// Yeni modüllerin (İTS, emanet, gelir-gider ...) kayıtlarını tutan genel depo.
// Her kayıt eczaneye ve kimliğine göre tutulan bir JSON belgedir; PostgreSQL'de her modülün kendi tablosu vardır.
// Değişiklikler eczane başına sırayla yürür: okunan belgeler işlem bitene kadar başka bir istekle değişmez.

export interface Belge {
  id: string;
}

export interface BelgeYazimi<S, T> {
  sonuc: S;
  /** Eklenecek ya da yerine yazılacak belgeler */
  yaz?: T[];
}

export interface BelgeDeposu<T extends Belge> {
  liste(eczaneId: string): Promise<T[]>;
  al(eczaneId: string, id: string): Promise<T | undefined>;
  /**
   * Verilen kimliklerdeki belgeleri okuyup işlemi yürütür ve döndürdüğü belgeleri yazar.
   * Haritada yalnızca var olan belgeler bulunur. İşlem hata fırlatırsa hiçbir şey yazılmaz.
   */
  degistir<S>(eczaneId: string, idler: string[], f: (mevcut: Map<string, T>) => BelgeYazimi<S, T>): Promise<S>;
}

/** Modülün depo tablosunu verir. PostgreSQL'de tablo adı göçlerdekiyle aynı olmalı. */
export type BelgeDeposuUretici = <T extends Belge>(tablo: string) => BelgeDeposu<T>;

const kopya = <T>(x: T): T => structuredClone(x);

export class BellekBelgeDeposu<T extends Belge> implements BelgeDeposu<T> {
  private readonly belgeler = new Map<string, Map<string, T>>();
  private sira: Promise<unknown> = Promise.resolve();

  private eczane(eczaneId: string) {
    if (!this.belgeler.has(eczaneId)) this.belgeler.set(eczaneId, new Map());
    return this.belgeler.get(eczaneId)!;
  }

  async liste(eczaneId: string) {
    return [...this.eczane(eczaneId).values()].map(kopya);
  }

  async al(eczaneId: string, id: string) {
    const b = this.eczane(eczaneId).get(id);
    return b && kopya(b);
  }

  degistir<S>(eczaneId: string, idler: string[], f: (mevcut: Map<string, T>) => BelgeYazimi<S, T>): Promise<S> {
    const is = this.sira.then(() => {
      const e = this.eczane(eczaneId);
      const mevcut = new Map<string, T>();
      for (const id of idler) {
        const b = e.get(id);
        if (b) mevcut.set(id, kopya(b));
      }
      const { sonuc, yaz = [] } = f(mevcut);
      for (const b of yaz) e.set(b.id, kopya(b));
      return sonuc;
    });
    this.sira = is.catch(() => undefined);
    return is;
  }
}

/** Testler ve veritabanısız geliştirme için: her tablo için bir bellek deposu. */
export function bellekBelgeDepolari(): BelgeDeposuUretici {
  const depolar = new Map<string, BellekBelgeDeposu<Belge>>();
  return <T extends Belge>(tablo: string) => {
    if (!depolar.has(tablo)) depolar.set(tablo, new BellekBelgeDeposu());
    return depolar.get(tablo) as unknown as BelgeDeposu<T>;
  };
}
