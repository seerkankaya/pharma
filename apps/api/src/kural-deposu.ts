import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { IlacKurali } from '@scalpiq/sut-motoru';

/** Kural kitaplığının saklandığı yer. Onaylanmış kural değiştirilmez, yalnızca geçerliliği kapatılır. */
export interface KuralDeposu {
  listele(): Promise<IlacKurali[]>;
  kaydet(kurallar: IlacKurali[]): Promise<void>;
}

export class BellekKuralDeposu implements KuralDeposu {
  constructor(private kurallar: IlacKurali[] = []) {}
  async listele() {
    return structuredClone(this.kurallar);
  }
  async kaydet(kurallar: IlacKurali[]) {
    this.kurallar = structuredClone(kurallar);
  }
}

/** Tüm kitaplık tek bir JSON dosyasında; yazma önce geçici dosyaya yapılır, sonra yer değiştirilir. */
export class DosyaKuralDeposu implements KuralDeposu {
  constructor(
    private readonly yol: string,
    private readonly baslangic: IlacKurali[] = [],
  ) {}

  async listele(): Promise<IlacKurali[]> {
    try {
      return JSON.parse(await readFile(this.yol, 'utf8')) as IlacKurali[];
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return structuredClone(this.baslangic);
      throw e;
    }
  }

  async kaydet(kurallar: IlacKurali[]) {
    await mkdir(dirname(this.yol), { recursive: true });
    const gecici = `${this.yol}.tmp`;
    await writeFile(gecici, `${JSON.stringify(kurallar, null, 2)}\n`, 'utf8');
    await rename(gecici, this.yol);
  }
}
