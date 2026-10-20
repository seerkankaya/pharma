import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Bulgu, Durum, Gerekceler } from '@scalpiq/sut-motoru';

/**
 * Medula'ya gönderilen her reçetenin kontrol izi.
 * SGK itirazında eczacının elindeki kanıt budur: hangi uyarı görüldü, hangi gerekçeyle geçildi.
 */
export interface DenetimKaydi {
  zaman: string;
  receteNo: string;
  durum: Durum;
  bulgular: Pick<Bulgu, 'kuralId' | 'seviye' | 'mesaj' | 'kaynaklar' | 'barkod'>[];
  gerekceler: Gerekceler;
  ek4aYayimTarihi: string;
  takipNo?: string;
}

export interface DenetimDeposu {
  ekle(kayit: DenetimKaydi): Promise<void>;
  listele(): Promise<DenetimKaydi[]>;
}

export class BellekDenetimDeposu implements DenetimDeposu {
  private kayitlar: DenetimKaydi[] = [];
  async ekle(kayit: DenetimKaydi) {
    this.kayitlar.push(kayit);
  }
  async listele() {
    return [...this.kayitlar];
  }
}

/** Satır başına bir JSON kaydı; yalnızca sona eklenir, değiştirilmez. */
export class DosyaDenetimDeposu implements DenetimDeposu {
  constructor(private readonly yol: string) {}

  async ekle(kayit: DenetimKaydi) {
    await mkdir(dirname(this.yol), { recursive: true });
    await appendFile(this.yol, `${JSON.stringify(kayit)}\n`, 'utf8');
  }

  async listele() {
    try {
      const metin = await readFile(this.yol, 'utf8');
      return metin
        .split('\n')
        .filter(Boolean)
        .map((s) => JSON.parse(s) as DenetimKaydi);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw e;
    }
  }
}
