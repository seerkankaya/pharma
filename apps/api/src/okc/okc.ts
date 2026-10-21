import type { KdvOrani, OdemeTuru, Satis } from '../stok/stok.js';

// Yeni nesil ödeme kaydedici cihaz (ÖKC) ve POS bağlantı katmanı. Satış kaydedildikten sonra fişi ÖKC'den
// kesilir; kartlı satışta önce POS'tan tahsilat alınır, onay kodu fişe yazılır. Cihaz markasına özgü bağlantı
// (seri port, ağ, üretici kütüphanesi) OkcIstemcisi arayüzünün arkasında kalır; şimdilik sahte cihaz kullanılır.

export interface FisKalemi {
  ad: string;
  miktar: number;
  birimFiyatKurus: number;
  kdvOrani: KdvOrani;
  tutarKurus: number;
}

export interface FisIstegi {
  /** Satış kimliği; cihaz aynı satış için ikinci fişi bu kimlikle reddedebilir */
  belgeId: string;
  kalemler: FisKalemi[];
  toplamKurus: number;
  odemeTuru: OdemeTuru;
  /** Kartlı satışta POS onay kodu */
  kartOnayKodu?: string;
}

export interface FisSonucu {
  basarili: boolean;
  fisNo?: string;
  zNo?: string;
  hata?: string;
}

export interface KartSonucu {
  basarili: boolean;
  onayKodu?: string;
  /** Örn. 4543 **** **** 1234 */
  maskeliKart?: string;
  hata?: string;
}

export interface OkcIstemcisi {
  kartTahsilat(eczaneId: string, tutarKurus: number, belgeId: string): Promise<KartSonucu>;
  fisKes(eczaneId: string, fis: FisIstegi): Promise<FisSonucu>;
}

export type FisDurumu = 'yaziliyor' | 'yazildi' | 'hata';

export interface OkcFisi {
  /** Satış kimliğiyle aynı: bir satışın bir fişi olur */
  id: string;
  satisId: string;
  toplamKurus: number;
  odemeTuru: OdemeTuru;
  durum: FisDurumu;
  deneme: number;
  fisNo?: string;
  zNo?: string;
  kart?: { onayKodu: string; maskeliKart?: string };
  hata?: string;
  kaydeden: string;
  zaman: string;
}

export const fisIstegi = (s: Satis, kartOnayKodu?: string): FisIstegi => ({
  belgeId: s.id,
  kalemler: s.kalemler.map(({ ad, miktar, birimFiyatKurus, kdvOrani, tutarKurus }) => ({ ad, miktar, birimFiyatKurus, kdvOrani, tutarKurus })),
  toplamKurus: s.toplamKurus,
  odemeTuru: s.odemeTuru,
  ...(kartOnayKodu ? { kartOnayKodu } : {}),
});

/** Takılı kalan "yazılıyor" kaydı 2 dakika sonra yeniden denenebilir. */
export const yazilabilirMi = (f: OkcFisi | undefined, simdi: Date) =>
  !f || f.durum === 'hata' || (f.durum === 'yaziliyor' && simdi.getTime() - Date.parse(f.zaman) > 2 * 60_000);

export interface FisOzeti {
  fisSayisi: number;
  nakitKurus: number;
  kartKurus: number;
  /** Fişi kesilmemiş ya da hatada kalmış satışlar */
  fissizSatislar: { satisId: string; zaman: string; toplamKurus: number; odemeTuru: OdemeTuru; hata?: string }[];
}

/** Günün satışlarını kesilen fişlerle eşleştirir; kasa kapanmadan fişsiz satış kalmadığı buradan görülür. */
export function fisOzeti(satislar: Satis[], fisler: OkcFisi[]): FisOzeti {
  const f = new Map(fisler.map((x) => [x.satisId, x]));
  const yazilan = satislar.filter((s) => f.get(s.id)?.durum === 'yazildi');
  const topla = (t: OdemeTuru) => yazilan.filter((s) => s.odemeTuru === t).reduce((a, s) => a + s.toplamKurus, 0);
  return {
    fisSayisi: yazilan.length,
    nakitKurus: topla('nakit'),
    kartKurus: topla('kart'),
    fissizSatislar: satislar
      .filter((s) => f.get(s.id)?.durum !== 'yazildi')
      .map((s) => ({
        satisId: s.id,
        zaman: s.zaman,
        toplamKurus: s.toplamKurus,
        odemeTuru: s.odemeTuru,
        ...(f.get(s.id)?.hata ? { hata: f.get(s.id)!.hata } : {}),
      })),
  };
}

/** Geliştirme ve test için cihaza gitmeyen ÖKC/POS. */
export class SahteOkc implements OkcIstemcisi {
  readonly fisler: FisIstegi[] = [];
  /** true iken POS kartı reddeder */
  kartReddet = false;
  /** true iken ÖKC bağlantısı yokmuş gibi davranır */
  bagliDegil = false;
  private sayac = 0;

  async kartTahsilat(_eczaneId: string, tutarKurus: number, belgeId: string): Promise<KartSonucu> {
    if (this.bagliDegil) return { basarili: false, hata: 'POS bağlantısı yok' };
    if (this.kartReddet) return { basarili: false, hata: 'Kart reddedildi' };
    return { basarili: true, onayKodu: `SAHTE-${belgeId.slice(0, 6)}-${tutarKurus}`, maskeliKart: '4543 **** **** 0000' };
  }

  async fisKes(_eczaneId: string, fis: FisIstegi): Promise<FisSonucu> {
    if (this.bagliDegil) return { basarili: false, hata: 'ÖKC bağlantısı yok' };
    if (this.fisler.some((f) => f.belgeId === fis.belgeId)) return { basarili: false, hata: 'Bu belge için fiş zaten kesilmiş' };
    this.fisler.push(structuredClone(fis));
    return { basarili: true, fisNo: String(++this.sayac).padStart(4, '0'), zNo: '0001' };
  }
}
