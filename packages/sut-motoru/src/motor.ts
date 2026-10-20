import { kalemKurallari, receteKurallari } from './kurallar/index.js';
import { aralikta } from './tarih.js';
import type { Bulgu, Durum, Gerekceler, IlacKurali, KontrolGirdisi, KontrolSonucu } from './types.js';

function esit(a: string, b: string): boolean {
  return a.trim().toLocaleUpperCase('tr-TR') === b.trim().toLocaleUpperCase('tr-TR');
}

/** Etken madde için reçete tarihinde geçerli kuralı bulur. */
export function gecerliKural(kurallar: IlacKurali[], etkenMadde: string, tarih: string): IlacKurali | undefined {
  return kurallar.find((k) => esit(k.etkenMadde, etkenMadde) && aralikta(tarih, k.gecerlilik.baslangic, k.gecerlilik.bitis));
}

export function kontrolEt(girdi: KontrolGirdisi): KontrolSonucu {
  const { recete } = girdi;
  const bulgular: Bulgu[] = receteKurallari.flatMap((k) => k.calistir(girdi));

  for (const kalem of recete.kalemler) {
    const kural = gecerliKural(girdi.ilacKurallari, kalem.etkenMadde, recete.tarih);
    const raporlar = recete.raporlar.filter((r) => r.ilaclar.some((i) => esit(i.etkenMadde, kalem.etkenMadde)));
    for (const k of kalemKurallari) bulgular.push(...k.calistir({ girdi, kalem, kural, raporlar }));
  }

  return {
    receteNo: recete.no,
    durum: durumHesapla(bulgular),
    bulgular,
    kontrolTarihi: girdi.bugun,
    ek4aYayimTarihi: girdi.ek4a.yayimTarihi,
  };
}

function durumHesapla(bulgular: Bulgu[]): Durum {
  if (bulgular.some((b) => b.seviye === 'kirmizi')) return 'kirmizi';
  if (bulgular.length > 0) return 'sari';
  return 'yesil';
}

/** Sarı bir bulgunun gerekçe anahtarı. Aynı kural farklı kalemlerde ayrı gerekçe ister. */
export function gerekceAnahtari(b: Bulgu): string {
  return b.barkod ? `${b.kuralId}:${b.barkod}` : b.kuralId;
}

export const ASGARI_GEREKCE_UZUNLUGU = 10;

export interface GonderimKarari {
  izin: boolean;
  /** İzin verilmiyorsa nedenleri */
  engeller: string[];
}

/**
 * Medula'ya gönderim kilidi. Kırmızı bulgu varsa gönderim yapılamaz.
 * Sarı bulguların her biri için eczacının gerekçe yazması gerekir.
 */
export function gonderimeIzinVarMi(sonuc: KontrolSonucu, gerekceler: Gerekceler = {}): GonderimKarari {
  const engeller: string[] = [];
  for (const b of sonuc.bulgular) {
    if (b.seviye === 'kirmizi') {
      engeller.push(`Düzeltilmesi gereken: ${b.mesaj}`);
    } else if ((gerekceler[gerekceAnahtari(b)]?.trim().length ?? 0) < ASGARI_GEREKCE_UZUNLUGU) {
      engeller.push(`Gerekçe gerekli: ${b.mesaj}`);
    }
  }
  return { izin: engeller.length === 0, engeller };
}
