import { XMLParser } from 'fast-xml-parser';
import { KDV_ORANLARI, type KdvOrani } from '../stok/stok.js';
import type { AlisKalemiIstegi } from '../alis/alis.js';

// Depodan gelen e-Fatura (UBL-TR 1.2 XML) dosyasını alış faturası taslağına çevirir.
// Taslak kaydedilmez: eczacı ekranda eksikleri (parti, SKT, yeni ürünlerin satış fiyatı) tamamlayıp
// mevcut alış faturası kaydıyla stoğa alır. Böylece stoğa giriş kuralları tek yerde kalır.

export interface EfaturaTaslagi {
  /** e-Faturanın evrensel kimliği (ETTN) */
  ettn?: string;
  faturaNo: string;
  tarih: string;
  tip?: string;
  satici: { ad: string; vergiNo?: string };
  kalemler: (Partial<AlisKalemiIstegi> & { barkod: string; miktar: number; birimFiyatKurus: number })[];
  /** Faturada yazan ödenecek tutar */
  odenecekKurus?: number;
  uyarilar: string[];
}

export class EfaturaHatasi extends Error {}

type Dugum = Record<string, unknown>;

const cozucu = new XMLParser({
  removeNSPrefix: true,
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  // Varlık (entity) açılmaz: dışarıdan gelen dosyada varlık genişletme saldırısına kapı bırakılmaz.
  processEntities: false,
  parseTagValue: false,
  trimValues: true,
});

const dizi = <T>(x: T | T[] | undefined): T[] => (x === undefined ? [] : Array.isArray(x) ? x : [x]);
/** Düğümün metni: <cbc:ID schemeID="VKN">123</cbc:ID> gibi öznitelikli düğümlerde #text içindedir. */
const metin = (x: unknown): string | undefined => {
  if (x === undefined || x === null) return undefined;
  if (typeof x === 'object') return metin((x as Dugum)['#text']);
  const s = String(x).trim();
  return s || undefined;
};
const al = (d: unknown, ...yol: string[]): unknown => yol.reduce<unknown>((x, a) => (x && typeof x === 'object' ? dizi((x as Dugum)[a] as Dugum)[0] : undefined), d);
const tutar = (x: unknown) => {
  const s = metin(x);
  if (s === undefined) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
};
const kurus = (n: number) => Math.round(n * 100);

/** Kalemin barkodu: standart ürün kimliği, satıcının ya da alıcının ürün kodu arasında barkoda benzeyen ilk değer. */
function barkodBul(urun: unknown): string | undefined {
  for (const alan of ['StandardItemIdentification', 'SellersItemIdentification', 'BuyersItemIdentification', 'ManufacturersItemIdentification']) {
    const s = metin(al(urun, alan, 'ID'))?.replace(/\s/g, '');
    if (s && /^\d{8,14}$/.test(s)) return s.length === 14 && s.startsWith('0') ? s.slice(1) : s;
  }
  return undefined;
}

/** KDV oranı: birden çok vergi varsa (ÖTV gibi) KDV'ninki (vergi kodu 0015) alınır. */
function kdvOrani(satir: unknown): number | undefined {
  const altlar = dizi((al(satir, 'TaxTotal') as Dugum | undefined)?.TaxSubtotal as Dugum | Dugum[] | undefined);
  const kdv = altlar.find((a) => metin(al(a, 'TaxCategory', 'TaxScheme', 'TaxTypeCode')) === '0015') ?? (altlar.length === 1 ? altlar[0] : undefined);
  return tutar(al(kdv, 'Percent'));
}

export function efaturaOku(xml: string): EfaturaTaslagi {
  let kok: Dugum;
  try {
    kok = cozucu.parse(xml) as Dugum;
  } catch (e) {
    throw new EfaturaHatasi(`XML okunamadı: ${(e as Error).message}`);
  }
  const f = kok.Invoice as Dugum | undefined;
  if (!f || typeof f !== 'object') throw new EfaturaHatasi('Dosya bir UBL-TR e-Fatura (Invoice) değil');

  const uyarilar: string[] = [];
  const tip = metin(f.InvoiceTypeCode);
  if (tip === 'IADE') throw new EfaturaHatasi('Bu bir iade faturası; alış faturası olarak aktarılamaz');
  const para = metin(f.DocumentCurrencyCode);
  if (para && para !== 'TRY') throw new EfaturaHatasi(`Fatura ${para} cinsinden; yalnızca TL faturalar aktarılabilir`);

  const faturaNo = metin(f.ID);
  const tarih = metin(f.IssueDate);
  if (!faturaNo) throw new EfaturaHatasi('Fatura numarası (ID) bulunamadı');
  if (!tarih || !/^\d{4}-\d{2}-\d{2}$/.test(tarih)) throw new EfaturaHatasi('Fatura tarihi (IssueDate) bulunamadı');

  const taraf = al(f, 'AccountingSupplierParty', 'Party');
  const kimlikler = dizi((taraf as Dugum | undefined)?.PartyIdentification as Dugum | Dugum[]).map((p) => p.ID as Dugum | string);
  const vkn = kimlikler.find((i) => typeof i === 'object' && ['VKN', 'TCKN'].includes(String(i['@schemeID'])));
  const satici = {
    ad: metin(al(taraf, 'PartyName', 'Name')) ?? ([metin(al(taraf, 'Person', 'FirstName')), metin(al(taraf, 'Person', 'FamilyName'))].filter(Boolean).join(' ') || 'Bilinmeyen satıcı'),
    ...(metin(vkn) ? { vergiNo: metin(vkn) } : {}),
  };

  const kalemler: EfaturaTaslagi['kalemler'] = [];
  for (const [i, satir] of dizi(f.InvoiceLine as Dugum | Dugum[]).entries()) {
    const s = `${i + 1}. satır`;
    const urun = al(satir, 'Item');
    const ad = metin(al(urun, 'Name'));
    const barkod = barkodBul(urun);
    const miktar = tutar(al(satir, 'InvoicedQuantity'));
    const fiyat = tutar(al(satir, 'Price', 'PriceAmount'));
    const net = tutar(al(satir, 'LineExtensionAmount'));
    if (!barkod) {
      uyarilar.push(`${s} (${ad ?? 'adsız'}): barkod bulunamadı, satır aktarılmadı`);
      continue;
    }
    if (miktar === undefined || miktar <= 0 || !Number.isInteger(miktar)) {
      uyarilar.push(`${s} (${ad ?? barkod}): miktar tamsayı değil (${miktar ?? 'yok'}), satır aktarılmadı`);
      continue;
    }
    const birimFiyatKurus = kurus(fiyat ?? 0);

    // Fiyatı sıfır olan satır mal fazlasıdır; aynı ürünün ücretli satırına eklenir.
    if (birimFiyatKurus === 0) {
      const ucretli = kalemler.find((k) => k.barkod === barkod && k.birimFiyatKurus > 0);
      if (ucretli) {
        ucretli.malFazlasi = (ucretli.malFazlasi ?? 0) + miktar;
        continue;
      }
      uyarilar.push(`${s} (${ad ?? barkod}): bedelsiz satır, mal fazlası olarak sıfır maliyetle eklendi`);
    }

    // İskonto, satır tutarı ile miktar × birim fiyat farkından bulunur; tek ya da çoklu iskonto aynı sonucu verir.
    const brut = miktar * (fiyat ?? 0);
    const iskontoYuzde = net !== undefined && brut > 0 && net < brut ? Math.round((1 - net / brut) * 1e6) / 1e4 : 0;

    const oran = kdvOrani(satir);
    if (oran === undefined || !KDV_ORANLARI.includes(oran as KdvOrani)) uyarilar.push(`${s} (${ad ?? barkod}): KDV oranı okunamadı (${oran ?? 'yok'}), elle seçin`);

    const lot = al(urun, 'ItemInstance', 'LotIdentification');
    const partiNo = metin(al(lot, 'LotNumberID'));
    const skt = metin(al(lot, 'ExpiryDate'));
    if (!partiNo || !skt) uyarilar.push(`${s} (${ad ?? barkod}): faturada parti no ya da son kullanma tarihi yok, elle girin`);

    kalemler.push({
      barkod,
      ...(ad ? { ad } : {}),
      miktar,
      birimFiyatKurus,
      ...(oran !== undefined && KDV_ORANLARI.includes(oran as KdvOrani) ? { kdvOrani: oran as KdvOrani } : {}),
      ...(iskontoYuzde ? { iskontoYuzde } : {}),
      partiNo: partiNo ?? '',
      skt: skt && /^\d{4}-\d{2}-\d{2}$/.test(skt) ? skt : '',
    });
  }
  if (kalemler.length === 0) uyarilar.push('Faturada aktarılabilecek satır yok');

  const odenecek = tutar(al(f, 'LegalMonetaryTotal', 'PayableAmount'));
  return {
    ...(metin(f.UUID) ? { ettn: metin(f.UUID) } : {}),
    faturaNo,
    tarih,
    ...(tip ? { tip } : {}),
    satici,
    kalemler,
    ...(odenecek !== undefined ? { odenecekKurus: kurus(odenecek) } : {}),
    uyarilar,
  };
}
