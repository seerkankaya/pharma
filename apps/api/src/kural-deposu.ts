import type { IlacKurali } from '@scalpiq/sut-motoru';

/** Bir kural işleminin sonucu: istemciye dönecek yanıt ve kaydedilecek ya da silinecek kurallar. */
export interface KuralDegisikligi<T> {
  sonuc: T;
  kaydet?: IlacKurali[];
  sil?: string[];
}

/** Kural kitaplığının saklandığı yer. Onaylanmış kural değiştirilmez, yalnızca geçerliliği kapatılır. */
export interface KuralDeposu {
  listele(): Promise<IlacKurali[]>;
  /**
   * Kitaplığı okuyup değiştirir. İşlemler sırayla yürür; böylece iki eczacı aynı anda
   * çakışan iki kuralı onaylayamaz.
   */
  degistir<T>(islem: (kurallar: IlacKurali[]) => KuralDegisikligi<T>): Promise<T>;
}

export class BellekKuralDeposu implements KuralDeposu {
  private sira: Promise<unknown> = Promise.resolve();

  constructor(private kurallar: IlacKurali[] = []) {
    this.kurallar = structuredClone(kurallar);
  }

  async listele() {
    return structuredClone(this.kurallar);
  }

  degistir<T>(islem: (kurallar: IlacKurali[]) => KuralDegisikligi<T>): Promise<T> {
    const sonuc = this.sira.then(() => {
      const d = islem(structuredClone(this.kurallar));
      const silinecek = new Set(d.sil ?? []);
      const yeniler = new Map((d.kaydet ?? []).map((k) => [k.id, structuredClone(k)]));
      const kalan = this.kurallar.filter((k) => !silinecek.has(k.id)).map((k) => yeniler.get(k.id) ?? k);
      for (const [id, k] of yeniler) if (!kalan.some((x) => x.id === id)) kalan.push(k);
      this.kurallar = kalan;
      return d.sonuc;
    });
    this.sira = sonuc.catch(() => undefined);
    return sonuc;
  }
}
