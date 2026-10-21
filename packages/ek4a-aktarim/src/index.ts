// SGK EK-4/A (Bedeli Ödenecek İlaçlar Listesi) Excel dosyasını okur.
// SGK sütun sırasını zaman zaman değiştirdiği için sütunlar başlık adına göre bulunur.
// Not: EK-4/A ödeme ve fiyat listesidir; ilaçların rapor ve kullanım koşullarını içermez.
// Bu koşullar SUT metninden ayrıca kural kitaplığına kodlanır.

import * as XLSX from 'xlsx';
import { haritaListesi, type Ek4aKaydi, type Ek4aListesi } from '@scalpiq/sut-motoru';

export interface Ek4aSatiri extends Ek4aKaydi {
  eskiBarkodlar: string[];
  listeyeGirisTarihi?: string;
  tur?: string;
}

export interface AktarimSonucu {
  sayfa: string;
  kayitlar: Ek4aSatiri[];
  uyarilar: string[];
}

function sade(s: unknown): string {
  return String(s ?? '')
    .toLocaleLowerCase('tr-TR')
    .replace(/\s+/g, ' ')
    .trim();
}

// Başlık metninde aranacak ifadeler; ilk eşleşen sütun kullanılır. SGK başlıkları dönem dönem değiştirdi:
// 2017 dosyasında "Ürün Adı", "Eski Barkod-1/2"; 2026 dosyasında "İlaç Adı", tek "Eski Barkodlar" sütunu ve
// aktiflenme/pasiflenme tarihleri var.
const SUTUNLAR = {
  kamuNo: ['kamu no'],
  barkod: ['güncel barkod', 'barkod'],
  ad: ['ürün adı', 'ilaç adı'],
  eski1: ['eski barkodlar', 'eski barkod-1', 'eski barkod 1'],
  eski2: ['eski barkod-2', 'eski barkod 2'],
  esdeger: ['eşdeğer'],
  giris: ['listeye giriş tarihi'],
  aktif: ['aktiflenme tarihi'],
  pasif: ['pasiflenme tarihi'],
  tur: ['orijinal / jenerik', 'orijinal/jenerik', 'uygulanan indirim oranlarına esas durumu'],
} as const;

/** Bulunamazsa uyarı verilmeyen sütunlar: dosyanın sürümüne göre bulunmayabilirler. */
const SECIMLIK = new Set(['eski2', 'aktif', 'pasif', 'tur']);

type SutunAdi = keyof typeof SUTUNLAR;

function basliklariBul(satirlar: unknown[][]): { satir: number; indeks: Partial<Record<SutunAdi, number>> } | undefined {
  for (let i = 0; i < Math.min(satirlar.length, 30); i++) {
    const hucreler = (satirlar[i] ?? []).map(sade);
    const indeks: Partial<Record<SutunAdi, number>> = {};
    for (const ad of Object.keys(SUTUNLAR) as SutunAdi[]) {
      for (const ifade of SUTUNLAR[ad]) {
        const j = hucreler.findIndex((h) => h.startsWith(ifade));
        if (j >= 0 && !Object.values(indeks).includes(j)) {
          indeks[ad] = j;
          break;
        }
      }
    }
    if (indeks.barkod !== undefined && indeks.ad !== undefined) return { satir: i, indeks };
  }
  return undefined;
}

/** Bir hücredeki barkodlar; yeni dosyada birden çok eski barkod aynı hücrede alt alta yazılır. */
function barkodlar(v: unknown): string[] {
  if (typeof v === 'number') return [barkodMetni(v)].filter((b): b is string => !!b);
  return String(v ?? '')
    .split(/[\s,;/]+/)
    .map(barkodMetni)
    .filter((b): b is string => !!b);
}

function barkodMetni(v: unknown): string | undefined {
  if (v === null || v === undefined || v === '') return undefined;
  const s = typeof v === 'number' ? v.toFixed(0) : String(v).trim();
  return /^\d{8,14}$/.test(s) ? s : undefined;
}

/** Excel seri tarihini (1900 sistemi) veya metni ISO tarihe çevirir. */
function tarihMetni(v: unknown): string | undefined {
  if (typeof v === 'number') return new Date(Math.round((v - 25569) * 86_400_000)).toISOString().slice(0, 10);
  if (typeof v === 'string') {
    const m = v.trim().match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
    if (m) return `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
  }
  return undefined;
}

/** Hücredeki tarihler; aynı ilaç birkaç kez pasiflenip aktiflenmişse tarihler "/" ile ayrılmış olarak gelir. */
function tarihler(v: unknown): (string | undefined)[] {
  if (typeof v === 'number') return [tarihMetni(v)];
  return String(v ?? '')
    .split(/[/\r\n]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map(tarihMetni);
}

const gunOncesi = (t: string) => new Date(Date.parse(`${t}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

/**
 * Pasiflenme ve aktiflenme tarihlerinden pasif dönemleri çıkarır. Her pasiflenme, ondan sonraki ilk
 * aktiflenmenin bir gün öncesine kadar sürer; sonrasında aktiflenme yoksa ilaç hâlâ pasiftir.
 */
export function pasifAraliklari(aktiflenme: string[], pasiflenme: string[]): { baslangic: string; bitis?: string }[] {
  const aktif = [...aktiflenme].sort();
  return [...pasiflenme].sort().map((baslangic) => {
    const sonraki = aktif.find((a) => a > baslangic);
    return sonraki ? { baslangic, bitis: gunOncesi(sonraki) } : { baslangic };
  });
}

export function ek4aOku(veri: ArrayBuffer | Uint8Array): AktarimSonucu {
  const wb = XLSX.read(veri, { type: 'array' });
  const sayfa = wb.SheetNames.find((s) => /4.?\/?.?A/i.test(s)) ?? wb.SheetNames[0];
  if (!sayfa) throw new Error('Excel dosyasında sayfa yok');
  const satirlar = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sayfa]!, { header: 1, blankrows: false });

  const baslik = basliklariBul(satirlar);
  if (!baslik) throw new Error(`"${sayfa}" sayfasında barkod ve ürün adı başlıkları bulunamadı`);
  const { indeks } = baslik;
  const al = (satir: unknown[], ad: SutunAdi) => (indeks[ad] === undefined ? undefined : satir[indeks[ad]!]);

  const uyarilar: string[] = [];
  for (const ad of Object.keys(SUTUNLAR) as SutunAdi[])
    if (indeks[ad] === undefined && !SECIMLIK.has(ad)) uyarilar.push(`"${SUTUNLAR[ad][0]}" sütunu bulunamadı`);

  const kayitlar: Ek4aSatiri[] = [];
  for (let i = baslik.satir + 1; i < satirlar.length; i++) {
    const satir = satirlar[i] ?? [];
    const barkod = barkodMetni(al(satir, 'barkod'));
    const ad = String(al(satir, 'ad') ?? '').trim();
    if (!barkod) {
      // Başlık altındaki sütun harfleri (A, B, C...) ve barkodu olmayan majistral satırı veri değildir, sessizce atlanır.
      const majistral = sade(al(satir, 'tur')).startsWith('majistral');
      if (ad && ad.length > 1 && !majistral) uyarilar.push(`${i + 1}. satır: geçerli barkod yok (${ad})`);
      continue;
    }
    const aktiflenme = tarihler(al(satir, 'aktif'));
    const pasiflenme = tarihler(al(satir, 'pasif'));
    if ([...aktiflenme, ...pasiflenme].includes(undefined)) uyarilar.push(`${i + 1}. satır: aktiflenme/pasiflenme tarihi okunamadı (${ad})`);
    const pasif = pasifAraliklari(aktiflenme.filter((t): t is string => !!t), pasiflenme.filter((t): t is string => !!t));
    const tur = String(al(satir, 'tur') ?? '').trim();
    kayitlar.push({
      barkod,
      ad,
      kamuNo: al(satir, 'kamuNo') ? String(al(satir, 'kamuNo')).trim() : undefined,
      esdegerGrubu: String(al(satir, 'esdeger') ?? '').trim() || undefined,
      eskiBarkodlar: [...new Set([...barkodlar(al(satir, 'eski1')), ...barkodlar(al(satir, 'eski2'))])].filter((b) => b !== barkod),
      listeyeGirisTarihi: tarihMetni(al(satir, 'giris')),
      tur: tur || undefined,
      ...(pasif.length ? { pasifAraliklari: pasif } : {}),
    });
  }
  return { sayfa, kayitlar, uyarilar };
}

export function ek4aListesiOlustur(yayimTarihi: string, sonuc: AktarimSonucu): Ek4aListesi {
  return haritaListesi(yayimTarihi, sonuc.kayitlar);
}
