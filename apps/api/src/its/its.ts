import type { Parti } from '../stok/stok.js';
import { tekilId, type Karekod } from './karekod.js';

// İlaç Takip Sistemi (İTS). Her ilaç kutusu GTIN ve seri numarasıyla tek tek izlenir.
// Eczanedeki her kutu hareketi (alım, satış, satış iptali, depoya iade, deaktivasyon) önce yerel kayda işlenir
// ve İTS'ye gidecek bildirim kuyruğuna eklenir; kuyruk ayrı bir adımda gönderilir. Böylece İTS'ye ulaşılamadığında
// tezgâh durmaz, bildirim sonra yeniden denenir.

export type TekilDurum = 'stokta' | 'satildi' | 'iade' | 'deaktive';
export type ItsIslemTuru = 'alim' | 'satis' | 'satis-iptal' | 'depo-iade' | 'deaktivasyon';
export const ITS_ISLEM_TURLERI: ItsIslemTuru[] = ['alim', 'satis', 'satis-iptal', 'depo-iade', 'deaktivasyon'];

/** Hangi işlemin hangi durumdan hangi duruma geçirdiği. "yok", kutunun eczanede hiç kaydı olmadığı anlamına gelir. */
const GECISLER: Record<ItsIslemTuru, { once: (TekilDurum | 'yok')[]; sonra: TekilDurum }> = {
  alim: { once: ['yok', 'iade'], sonra: 'stokta' },
  satis: { once: ['stokta'], sonra: 'satildi' },
  'satis-iptal': { once: ['satildi'], sonra: 'stokta' },
  'depo-iade': { once: ['stokta'], sonra: 'iade' },
  deaktivasyon: { once: ['stokta'], sonra: 'deaktive' },
};

const DURUM_ADI: Record<TekilDurum | 'yok', string> = {
  yok: 'eczanede kaydı yok',
  stokta: 'stokta',
  satildi: 'satılmış',
  iade: 'depoya iade edilmiş',
  deaktive: 'deaktive edilmiş',
};

/**
 * Deaktivasyon nedeni. Kod, İTS'nin deaktivasyon bildiriminde istediği neden kodudur; kodların listesi
 * İTS teknik belgesinden alınır, burada uydurulmaz. Eczacı kodu ve açıklamasını birlikte girer.
 */
export interface DeaktivasyonNedeni {
  kod: string;
  aciklama: string;
}

/** Bildirimin karşı tarafı (alımda gönderen depo, iadede alan depo). */
export interface KarsiTaraf {
  /** 13 haneli GLN */
  gln: string;
  ad?: string;
}

export interface TekilHareket {
  tur: ItsIslemTuru;
  zaman: string;
  kaydeden: string;
  bildirimId: string;
}

export interface TekilUrun {
  id: string;
  gtin: string;
  barkod: string;
  seriNo: string;
  skt: string;
  partiNo: string;
  durum: TekilDurum;
  hareketler: TekilHareket[];
}

export type BildirimDurumu = 'bekliyor' | 'gonderiliyor' | 'gonderildi' | 'reddedildi' | 'hata';

export interface UrunSonucu {
  gtin: string;
  seriNo: string;
  basarili: boolean;
  kod?: string;
  mesaj?: string;
}

export interface ItsBildirimi {
  id: string;
  tur: ItsIslemTuru;
  urunler: Pick<Karekod, 'gtin' | 'seriNo' | 'skt' | 'partiNo'>[];
  karsiTaraf?: KarsiTaraf;
  neden?: DeaktivasyonNedeni;
  /** Alımda depo faturası, satışta reçete ya da satış numarası */
  belgeNo?: string;
  durum: BildirimDurumu;
  deneme: number;
  hata?: string;
  /** İTS'nin reddettiği kutular */
  reddedilenler?: UrunSonucu[];
  olusturma: string;
  gonderim?: string;
  kaydeden: string;
}

export interface ItsGonderimSonucu {
  /** İTS'ye ulaşılamadıysa false; kuyruktaki bildirim sonra yeniden denenir */
  ulasildi: boolean;
  hata?: string;
  sonuclar: UrunSonucu[];
}

/**
 * İTS web servislerine erişim. Gerçek istemci eczanenin GLN'i ve İTS kullanıcı bilgileriyle çalışacak;
 * servis adları ve alanlar İTS'nin eczane teknik belgesinden alınacak.
 */
export interface ItsIstemcisi {
  bildir(eczaneId: string, bildirim: ItsBildirimi): Promise<ItsGonderimSonucu>;
  /** İTS'nin eczanenin üzerinde gördüğü kutular */
  stok(eczaneId: string): Promise<Pick<Karekod, 'gtin' | 'seriNo'>[]>;
}

export class ItsHatasi extends Error {
  constructor(
    mesaj: string,
    readonly hatalar: string[] = [],
  ) {
    super(mesaj);
  }
}

export interface ItsIslemIstegi {
  tur: ItsIslemTuru;
  karekodlar: Karekod[];
  karsiTaraf?: KarsiTaraf;
  neden?: DeaktivasyonNedeni;
  belgeNo?: string;
}

/** İsteğin işlemden bağımsız kurallarını denetler. */
export function islemIstegiDogrula(i: Partial<Omit<ItsIslemIstegi, 'karekodlar'>> & { karekodlar?: unknown[] }): string[] {
  const h: string[] = [];
  if (!ITS_ISLEM_TURLERI.includes(i.tur as ItsIslemTuru)) h.push(`İşlem türü ${ITS_ISLEM_TURLERI.join(', ')} olmalı`);
  if (!Array.isArray(i.karekodlar) || i.karekodlar.length === 0) h.push('En az bir karekod okutun');
  else if (i.karekodlar.length > 500) h.push('Bir bildirimde en çok 500 kutu olabilir');
  if ((i.tur === 'alim' || i.tur === 'depo-iade') && !/^\d{13}$/.test(i.karsiTaraf?.gln ?? '')) h.push('Deponun 13 haneli GLN numarasını girin');
  if (i.tur === 'deaktivasyon') {
    if (!/^\d{1,3}$/.test(i.neden?.kod ?? '')) h.push('Deaktivasyon neden kodunu girin (1-3 hane)');
    if (!i.neden?.aciklama?.trim()) h.push('Deaktivasyon nedenini açıklayın');
  }
  return h;
}

/**
 * İşlemi kutulara uygular: her kutunun bu işleme uygun durumda olduğunu denetler, yeni durumu ve
 * İTS'ye gidecek bildirimi hazırlar. Uygun olmayan bir kutu varsa hiçbir kutu değişmez.
 */
export function islemUygula(
  istek: ItsIslemIstegi,
  mevcut: Map<string, TekilUrun>,
  bilgi: { bildirimId: string; zaman: string; kaydeden: string; bugun: string },
): { tekiller: TekilUrun[]; bildirim: ItsBildirimi } {
  const gecis = GECISLER[istek.tur];
  const hatalar: string[] = [];
  const gorulen = new Set<string>();
  const tekiller: TekilUrun[] = [];
  for (const k of istek.karekodlar) {
    const id = tekilId(k);
    const etiket = `${k.barkod} / ${k.seriNo}`;
    if (gorulen.has(id)) {
      hatalar.push(`${etiket}: aynı kutu iki kez okutuldu`);
      continue;
    }
    gorulen.add(id);
    const t = mevcut.get(id);
    const durum = t?.durum ?? 'yok';
    if (!gecis.once.includes(durum)) {
      hatalar.push(`${etiket}: kutu ${DURUM_ADI[durum]}, bu işlem yapılamaz`);
      continue;
    }
    if (istek.tur === 'satis' && k.skt < bilgi.bugun) {
      hatalar.push(`${etiket}: miadı ${k.skt} tarihinde geçmiş, satılamaz`);
      continue;
    }
    const hareket: TekilHareket = { tur: istek.tur, zaman: bilgi.zaman, kaydeden: bilgi.kaydeden, bildirimId: bilgi.bildirimId };
    tekiller.push({
      id,
      gtin: k.gtin,
      barkod: k.barkod,
      seriNo: k.seriNo,
      // Alımda kutunun bilgileri karekoddan alınır; sonraki işlemlerde ilk kayıt korunur.
      skt: t?.skt ?? k.skt,
      partiNo: t?.partiNo ?? k.partiNo,
      durum: gecis.sonra,
      hareketler: [...(t?.hareketler ?? []), hareket],
    });
  }
  if (hatalar.length) throw new ItsHatasi('Bazı kutularda işlem yapılamaz', hatalar);
  return {
    tekiller,
    bildirim: {
      id: bilgi.bildirimId,
      tur: istek.tur,
      urunler: tekiller.map(({ gtin, seriNo, skt, partiNo }) => ({ gtin, seriNo, skt, partiNo })),
      ...(istek.karsiTaraf ? { karsiTaraf: { gln: istek.karsiTaraf.gln, ...(istek.karsiTaraf.ad?.trim() ? { ad: istek.karsiTaraf.ad.trim() } : {}) } } : {}),
      ...(istek.neden ? { neden: { kod: istek.neden.kod, aciklama: istek.neden.aciklama.trim() } } : {}),
      ...(istek.belgeNo?.trim() ? { belgeNo: istek.belgeNo.trim() } : {}),
      durum: 'bekliyor',
      deneme: 0,
      olusturma: bilgi.zaman,
      kaydeden: bilgi.kaydeden,
    },
  };
}

/** Gönderilmeyi bekleyen bildirimler. Takılı kalan "gönderiliyor" kaydı 5 dakika sonra yeniden denenir. */
export function gonderilecekMi(b: ItsBildirimi, simdi: Date) {
  if (b.durum === 'bekliyor' || b.durum === 'hata') return true;
  return b.durum === 'gonderiliyor' && simdi.getTime() - Date.parse(b.gonderim ?? b.olusturma) > 5 * 60_000;
}

/** İTS'nin yanıtını bildirime işler. */
export function sonucuIsle(b: ItsBildirimi, s: ItsGonderimSonucu, zaman: string): ItsBildirimi {
  const { hata: _h, reddedilenler: _r, ...temel } = b;
  if (!s.ulasildi) return { ...temel, durum: 'hata', hata: s.hata ?? "İTS'ye ulaşılamadı", gonderim: zaman };
  const reddedilenler = s.sonuclar.filter((x) => !x.basarili);
  return reddedilenler.length ? { ...temel, durum: 'reddedildi', reddedilenler, gonderim: zaman } : { ...temel, durum: 'gonderildi', gonderim: zaman };
}

export interface StokKarsilastirmasi {
  /** Eczanede stokta görünen ama İTS'de eczanenin üzerinde olmayan kutular */
  sadeceYerelde: TekilUrun[];
  /** İTS'de eczanenin üzerinde olan ama yerelde stokta olmayan kutular */
  sadeceItsde: (Pick<Karekod, 'gtin' | 'seriNo'> & { yerelDurum?: TekilDurum })[];
  /** Karekodla izlenen kutu sayısı ile stok kartındaki adedin tutmadığı ürünler */
  adetFarklari: { barkod: string; karekodlu: number; stokta: number }[];
}

export function stokKarsilastir(
  tekiller: TekilUrun[],
  its: Pick<Karekod, 'gtin' | 'seriNo'>[],
  partiStogu: Map<string, Parti[]>,
): StokKarsilastirmasi {
  const yerel = new Map(tekiller.map((t) => [t.id, t]));
  const itsIdleri = new Set(its.map(tekilId));
  const stokta = tekiller.filter((t) => t.durum === 'stokta');

  const karekodlu = new Map<string, number>();
  for (const t of stokta) karekodlu.set(t.barkod, (karekodlu.get(t.barkod) ?? 0) + 1);
  const adetFarklari: StokKarsilastirmasi['adetFarklari'] = [];
  for (const barkod of new Set([...karekodlu.keys()].concat(tekiller.map((t) => t.barkod)))) {
    const k = karekodlu.get(barkod) ?? 0;
    const s = (partiStogu.get(barkod) ?? []).reduce((t, p) => t + p.miktar, 0);
    if (k !== s) adetFarklari.push({ barkod, karekodlu: k, stokta: s });
  }

  return {
    sadeceYerelde: stokta.filter((t) => !itsIdleri.has(t.id)),
    sadeceItsde: its
      .filter((x) => yerel.get(tekilId(x))?.durum !== 'stokta')
      .map((x) => {
        const d = yerel.get(tekilId(x))?.durum;
        return { gtin: x.gtin, seriNo: x.seriNo, ...(d ? { yerelDurum: d } : {}) };
      }),
    adetFarklari: adetFarklari.sort((a, b) => a.barkod.localeCompare(b.barkod)),
  };
}

/**
 * Geliştirme ve test için İTS'ye gitmeyen istemci. Eczanelerin İTS'deki stoğunu bellekte tutar ve
 * gerçek sistemin temel denetimlerini yapar: üzerinde olmayan kutu satılamaz, iade edilemez, deaktive edilemez.
 */
export class SahteIts implements ItsIstemcisi {
  readonly gonderilenler: ItsBildirimi[] = [];
  /** true iken İTS'ye ulaşılamıyormuş gibi davranır */
  kapali = false;
  private readonly stoklar = new Map<string, Map<string, Pick<Karekod, 'gtin' | 'seriNo'>>>();

  private eczane(eczaneId: string) {
    if (!this.stoklar.has(eczaneId)) this.stoklar.set(eczaneId, new Map());
    return this.stoklar.get(eczaneId)!;
  }

  /** Test için: kutuyu eczanenin İTS stoğuna doğrudan koyar. */
  stogaKoy(eczaneId: string, k: Pick<Karekod, 'gtin' | 'seriNo'>) {
    this.eczane(eczaneId).set(tekilId(k), { gtin: k.gtin, seriNo: k.seriNo });
  }

  async bildir(eczaneId: string, b: ItsBildirimi): Promise<ItsGonderimSonucu> {
    if (this.kapali) return { ulasildi: false, hata: 'İTS yanıt vermiyor', sonuclar: [] };
    this.gonderilenler.push(structuredClone(b));
    const stok = this.eczane(eczaneId);
    const sonuclar = b.urunler.map((u): UrunSonucu => {
      const id = tekilId(u);
      const uzerinde = stok.has(id);
      if (b.tur === 'alim' || b.tur === 'satis-iptal') {
        if (uzerinde) return { gtin: u.gtin, seriNo: u.seriNo, basarili: false, kod: 'SAHTE-1', mesaj: 'Ürün zaten eczanenin üzerinde' };
        stok.set(id, { gtin: u.gtin, seriNo: u.seriNo });
      } else {
        if (!uzerinde) return { gtin: u.gtin, seriNo: u.seriNo, basarili: false, kod: 'SAHTE-2', mesaj: 'Ürün eczanenin üzerinde değil' };
        stok.delete(id);
      }
      return { gtin: u.gtin, seriNo: u.seriNo, basarili: true };
    });
    return { ulasildi: true, sonuclar };
  }

  async stok(eczaneId: string) {
    return [...this.eczane(eczaneId).values()];
  }
}
