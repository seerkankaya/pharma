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

// Başlık metninde aranacak ifadeler; ilk eşleşen sütun kullanılır.
const SUTUNLAR = {
  kamuNo: ['kamu no'],
  barkod: ['güncel barkod', 'barkod'],
  ad: ['ürün adı', 'ilaç adı'],
  eski1: ['eski barkod-1', 'eski barkod 1'],
  eski2: ['eski barkod-2', 'eski barkod 2'],
  esdeger: ['eşdeğer'],
  giris: ['listeye giriş tarihi'],
  tur: ['orijinal / jenerik', 'orijinal/jenerik'],
} as const;

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

function barkodMetni(v: unknown): string | undefined {
  if (v === null || v === undefined || v === '') return undefined;
  const s = typeof v === 'number' ? v.toFixed(0) : String(v).trim();
  return /^\d{8,14}$/.test(s) ? s : undefined;
}

/** Excel seri tarihini (1900 sistemi) veya metni ISO tarihe çevirir. */
function tarihMetni(v: unknown): string | undefined {
  if (typeof v === 'number') return new Date(Math.round((v - 25569) * 86_400_000)).toISOString().slice(0, 10);
  if (typeof v === 'string') {
    const m = v.match(/^(\d{2})[./](\d{2})[./](\d{4})$/);
    if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  }
  return undefined;
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
  for (const ad of Object.keys(SUTUNLAR) as SutunAdi[]) if (indeks[ad] === undefined) uyarilar.push(`"${ad}" sütunu bulunamadı`);

  const kayitlar: Ek4aSatiri[] = [];
  for (let i = baslik.satir + 1; i < satirlar.length; i++) {
    const satir = satirlar[i] ?? [];
    const barkod = barkodMetni(al(satir, 'barkod'));
    const ad = String(al(satir, 'ad') ?? '').trim();
    if (!barkod) {
      // Başlık altındaki sütun harfleri (A, B, C...) gibi veri olmayan satırlar sessizce atlanır.
      if (ad && ad.length > 1) uyarilar.push(`${i + 1}. satır: geçerli barkod yok (${ad})`);
      continue;
    }
    kayitlar.push({
      barkod,
      ad,
      kamuNo: al(satir, 'kamuNo') ? String(al(satir, 'kamuNo')).trim() : undefined,
      esdegerGrubu: al(satir, 'esdeger') ? String(al(satir, 'esdeger')).trim() : undefined,
      eskiBarkodlar: [al(satir, 'eski1'), al(satir, 'eski2')].map(barkodMetni).filter((b): b is string => !!b),
      listeyeGirisTarihi: tarihMetni(al(satir, 'giris')),
      tur: al(satir, 'tur') ? String(al(satir, 'tur')).trim() : undefined,
    });
  }
  return { sayfa, kayitlar, uyarilar };
}

export function ek4aListesiOlustur(yayimTarihi: string, sonuc: AktarimSonucu): Ek4aListesi {
  return haritaListesi(yayimTarihi, sonuc.kayitlar);
}
