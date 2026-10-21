// Motorun uyguladığı kontrol kuralları.
// Her kural saf bir fonksiyondur: aynı girdi her zaman aynı bulguları üretir.
// İlaca özgü koşullar (rapor şartı, branş, tanı, doz) burada değil, IlacKurali kayıtlarında tutulur.

import { aralikta, gunFarki } from '../tarih.js';
import type { Bulgu, IlacKurali, KontrolGirdisi, Kaynak, Rapor, ReceteKalemi } from '../types.js';

export interface KalemBaglami {
  girdi: KontrolGirdisi;
  kalem: ReceteKalemi;
  /** Reçete tarihinde geçerli olan ilaç kuralı (yoksa undefined) */
  kural?: IlacKurali;
  /** Kalemin etken maddesini içeren raporlar */
  raporlar: Rapor[];
}

export interface KalemKurali {
  id: string;
  baslik: string;
  calistir(b: KalemBaglami): Bulgu[];
}

export interface ReceteKurali {
  id: string;
  baslik: string;
  calistir(girdi: KontrolGirdisi): Bulgu[];
}

const SISTEM_KAYNAGI: Kaynak = {
  tur: 'Sistem',
  aciklama: 'ScalpIQ kural kitaplığı',
};

function kaynaklar(b: KalemBaglami): Kaynak[] {
  return b.kural ? [b.kural.kaynak] : [];
}

function bulgu(b: KalemBaglami, id: string, seviye: Bulgu['seviye'], mesaj: string, ek: Kaynak[] = []): Bulgu {
  return {
    kuralId: id,
    seviye,
    mesaj: `${b.kalem.ad}: ${mesaj}`,
    kaynaklar: [...kaynaklar(b), ...ek],
    barkod: b.kalem.barkod,
    ilacKuraliId: b.kural?.id,
    ornekKural: b.kural?.ornek === true || undefined,
  };
}

export function normalize(s: string): string {
  return s
    .trim()
    .toLocaleUpperCase('tr-TR')
    .replace(/İ/g, 'I')
    .replace(/Ş/g, 'S')
    .replace(/Ğ/g, 'G')
    .replace(/Ü/g, 'U')
    .replace(/Ö/g, 'O')
    .replace(/Ç/g, 'C')
    .replace(/\s+/g, ' ');
}

/**
 * Kalemdeki etken madde kuraldaki etken maddeye uyuyor mu? Medula etken maddeyi tuzuyla yazabilir
 * ("ATORVASTATIN KALSIYUM"); kural tuzsuz adla ("ATORVASTATIN") tutulur.
 */
export function etkenMaddeUyar(kuraldaki: string, kalemdeki: string): boolean {
  const k = normalize(kuraldaki);
  const r = normalize(kalemdeki);
  return r === k || r.startsWith(`${k} `);
}

/** Hekim branşı raporsuz yazabilenlerden mi? Öyleyse rapor koşulları aranmaz. */
function raporsuzYazabilir(b: KalemBaglami): boolean {
  const izinli = b.kural?.raporsuzYazabilenBranslar;
  return !!izinli?.length && bransVar(izinli, b.girdi.recete.hekim.brans);
}

/**
 * Branş izinliler arasında mı? Kural kısa adı tutar ("Endokrinoloji"); Medula'daki uzun ad
 * ("Endokrinoloji ve Metabolizma Hastalıkları") onunla başlıyorsa uyar.
 */
function bransVar(izinli: string[], brans: string): boolean {
  const b = normalize(brans);
  return izinli.some((i) => b === normalize(i) || b.startsWith(`${normalize(i)} `));
}

/** Raporlar arasından kuralın istediği koşulları en çok karşılayanı seçer. */
function enUygunRapor(b: KalemBaglami): Rapor | undefined {
  const tarih = b.girdi.recete.tarih;
  return [...b.raporlar].sort((x, y) => puan(y) - puan(x))[0];

  function puan(r: Rapor): number {
    let p = 0;
    if (aralikta(tarih, r.baslangic, r.bitis)) p += 4;
    if (!b.kural?.raporTuru || r.tur === b.kural.raporTuru) p += 2;
    if (!b.kural?.raporDuzenleyenBranslar || r.duzenleyenBranslar.some((x) => bransVar(b.kural!.raporDuzenleyenBranslar!, x))) p += 1;
    return p;
  }
}

export const kalemKurallari: KalemKurali[] = [
  {
    id: 'EK4A_LISTE',
    baslik: 'İlaç bedeli ödenecek ilaçlar listesinde mi',
    calistir(b) {
      if (b.girdi.ek4a.bul(b.kalem.barkod)) return [];
      return [
        bulgu(b, 'EK4A_LISTE', 'kirmizi', `Barkod ${b.kalem.barkod} güncel EK-4/A listesinde yok; bedeli SGK tarafından ödenmez.`, [
          {
            tur: 'EK-4/A',
            aciklama: `Bedeli Ödenecek İlaçlar Listesi, yayım tarihi ${b.girdi.ek4a.yayimTarihi}`,
          },
        ]),
      ];
    },
  },
  {
    id: 'KURAL_TANIMSIZ',
    baslik: 'İlaç için kural kitaplığında kayıt var mı',
    calistir(b) {
      if (b.kural) return [];
      return [
        {
          kuralId: 'KURAL_TANIMSIZ',
          seviye: 'sari',
          mesaj: `${b.kalem.ad}: ${b.kalem.etkenMadde} için ScalpIQ kural kitaplığında SUT koşulu tanımlı değil. Rapor ve kullanım koşullarını elle kontrol edin.`,
          kaynaklar: [SISTEM_KAYNAGI],
          barkod: b.kalem.barkod,
        },
      ];
    },
  },
  {
    id: 'RECETE_TURU',
    baslik: 'Reçete türü kuralın istediği türde mi',
    calistir(b) {
      const istenen = b.kural?.receteTuru;
      if (!istenen || b.girdi.recete.tur === istenen) return [];
      return [bulgu(b, 'RECETE_TURU', 'kirmizi', `Bu ilaç ${istenen} reçete ile yazılmalı, reçete türü ${b.girdi.recete.tur}.`)];
    },
  },
  {
    id: 'RECETE_EDEN_BRANS',
    baslik: 'Reçeteyi yazan hekimin branşı uygun mu',
    calistir(b) {
      const izinli = b.kural?.receteEdenBranslar;
      if (!izinli?.length || bransVar(izinli, b.girdi.recete.hekim.brans)) return [];
      return [
        bulgu(
          b,
          'RECETE_EDEN_BRANS',
          'kirmizi',
          `Reçeteyi yazan hekimin branşı (${b.girdi.recete.hekim.brans}) uygun değil. İzin verilen: ${izinli.join(', ')}.`,
        ),
      ];
    },
  },
  {
    id: 'RAPOR_GEREKLI',
    baslik: 'Rapor gerekiyorsa reçetede rapor var mı',
    calistir(b) {
      if (!b.kural?.raporGerekli || b.raporlar.length > 0 || raporsuzYazabilir(b)) return [];
      const raporsuz = b.kural.raporsuzYazabilenBranslar?.length
        ? ` Raporsuz yalnızca şu branşlar yazabilir: ${b.kural.raporsuzYazabilenBranslar.join(', ')}.`
        : '';
      return [bulgu(b, 'RAPOR_GEREKLI', 'kirmizi', `Bu ilaç raporla ödenir, ancak reçetede bu etken maddeyi içeren rapor yok.${raporsuz}`)];
    },
  },
  {
    id: 'RAPOR_TURU',
    baslik: 'Rapor türü uygun mu',
    calistir(b) {
      const istenen = b.kural?.raporTuru;
      const rapor = enUygunRapor(b);
      if (!istenen || !rapor || rapor.tur === istenen || raporsuzYazabilir(b)) return [];
      const ad = istenen === 'saglik-kurulu' ? 'sağlık kurulu raporu' : 'uzman hekim raporu';
      return [bulgu(b, 'RAPOR_TURU', 'kirmizi', `Bu ilaç ${ad} ister; ${rapor.no} numaralı rapor farklı türde.`)];
    },
  },
  {
    id: 'RAPOR_SURESI',
    baslik: 'Rapor reçete tarihinde geçerli mi',
    calistir(b) {
      const rapor = enUygunRapor(b);
      if (!rapor || aralikta(b.girdi.recete.tarih, rapor.baslangic, rapor.bitis) || raporsuzYazabilir(b)) return [];
      return [
        bulgu(
          b,
          'RAPOR_SURESI',
          'kirmizi',
          `${rapor.no} numaralı rapor ${rapor.baslangic} – ${rapor.bitis} arasında geçerli; reçete tarihi ${b.girdi.recete.tarih}.`,
        ),
      ];
    },
  },
  {
    id: 'RAPOR_BRANS',
    baslik: 'Raporu düzenleyen branş uygun mu',
    calistir(b) {
      const izinli = b.kural?.raporDuzenleyenBranslar;
      const rapor = enUygunRapor(b);
      if (!izinli?.length || !rapor || raporsuzYazabilir(b)) return [];
      if (rapor.duzenleyenBranslar.some((x) => bransVar(izinli, x))) return [];
      return [
        bulgu(
          b,
          'RAPOR_BRANS',
          'kirmizi',
          `Raporu düzenleyen branş (${rapor.duzenleyenBranslar.join(', ') || 'belirtilmemiş'}) uygun değil. İzin verilen: ${izinli.join(', ')}.`,
        ),
      ];
    },
  },
  {
    id: 'RAPOR_AZAMI_SURE',
    baslik: 'Rapor süresi ödeme koşulundaki en uzun süreyi aşıyor mu',
    calistir(b) {
      const azami = b.kural?.raporAzamiGun;
      const rapor = enUygunRapor(b);
      if (!azami || !rapor || raporsuzYazabilir(b)) return [];
      // Başlangıç ve bitiş günü dahil.
      const sure = gunFarki(rapor.baslangic, rapor.bitis) + 1;
      if (sure <= azami) return [];
      return [bulgu(b, 'RAPOR_AZAMI_SURE', 'kirmizi', `${rapor.no} numaralı rapor ${sure} günlük; bu ilaç için rapor en fazla ${azami} gün olabilir.`)];
    },
  },
  {
    id: 'RAPOR_ICERIGI',
    baslik: 'Raporda bulunması gereken bilgiler',
    calistir(b) {
      const istenen = b.kural?.raporIcerigi;
      if (!istenen?.length || raporsuzYazabilir(b) || !enUygunRapor(b)) return [];
      return [
        bulgu(
          b,
          'RAPOR_ICERIGI',
          'sari',
          `Raporda şunların yazılı olduğunu kontrol edin: ${istenen.join('; ')}. Yazılı değilse SGK bedeli keser.`,
        ),
      ];
    },
  },
  {
    id: 'TANI_UYUMU',
    baslik: 'Rapordaki tanı ilacın ödendiği endikasyona uyuyor mu',
    calistir(b) {
      const izinli = b.kural?.izinliTanilar;
      const rapor = enUygunRapor(b);
      if (!izinli?.length) return [];
      const tanilar = rapor ? rapor.tanilar : b.girdi.recete.tanilar;
      const uyumlu = tanilar.some((t) => izinli.some((onek) => normalize(t).startsWith(normalize(onek))));
      if (uyumlu) return [];
      return [
        bulgu(
          b,
          'TANI_UYUMU',
          'kirmizi',
          `${rapor ? 'Rapordaki' : 'Reçetedeki'} tanılar (${tanilar.join(', ') || 'yok'}) ödeme koşulundaki tanılarla (${izinli.join(', ')}) uyuşmuyor.`,
        ),
      ];
    },
  },
  {
    id: 'DOZ',
    baslik: 'Reçete dozu rapordaki ve izin verilen dozu aşıyor mu',
    calistir(b) {
      const doz = b.kalem.gunlukDoz;
      if (doz === undefined) return [];
      const sonuc: Bulgu[] = [];
      const rapor = enUygunRapor(b);
      const raporIlaci = rapor?.ilaclar.find((i) => etkenMaddeUyar(i.etkenMadde, b.kalem.etkenMadde) || etkenMaddeUyar(b.kalem.etkenMadde, i.etkenMadde));
      if (raporIlaci?.gunlukDoz !== undefined && doz > raporIlaci.gunlukDoz) {
        const birim = b.kalem.birim ? ` ${b.kalem.birim}` : '';
        sonuc.push(
          bulgu(b, 'DOZ', 'kirmizi', `Reçetedeki günlük doz (${doz}${birim}) rapordaki dozu (${raporIlaci.gunlukDoz}${birim}) aşıyor.`),
        );
      }
      const maks = b.kural?.maksGunlukDoz;
      if (maks !== undefined && doz > maks) {
        sonuc.push(bulgu(b, 'DOZ', 'kirmizi', `Günlük doz (${doz}) ödeme koşulundaki üst sınırı (${maks}) aşıyor.`));
      }
      return sonuc;
    },
  },
  {
    id: 'TEDAVI_SURESI',
    baslik: 'Verilen miktar izin verilen tedavi süresini aşıyor mu',
    calistir(b) {
      const maks = b.kural?.maksTedaviGunu;
      const { gunlukDoz, kutuIcerik, adet } = b.kalem;
      if (!maks || !gunlukDoz || !kutuIcerik) return [];
      const gun = Math.floor((adet * kutuIcerik) / gunlukDoz);
      if (gun <= maks) return [];
      return [bulgu(b, 'TEDAVI_SURESI', 'sari', `${adet} kutu ${gun} günlük tedaviye yetiyor; bir reçetede en fazla ${maks} günlük ilaç verilebilir.`)];
    },
  },
  {
    id: 'ERKEN_TEKRAR',
    baslik: 'Hastanın önceki ilacı henüz bitmeden yeniden veriliyor mu',
    calistir(b) {
      const gecmis = b.girdi.gecmis ?? [];
      const sonuc: Bulgu[] = [];
      for (const g of gecmis) {
        if (!etkenMaddeUyar(g.etkenMadde, b.kalem.etkenMadde) && !etkenMaddeUyar(b.kalem.etkenMadde, g.etkenMadde)) continue;
        const gunlukDoz = g.gunlukDoz ?? b.kalem.gunlukDoz;
        const icerik = g.kutuIcerik ?? b.kalem.kutuIcerik;
        if (!gunlukDoz || !icerik) continue;
        const yeterGun = (g.adet * icerik) / gunlukDoz;
        const gecen = gunFarki(g.tarih, b.girdi.bugun);
        const kalanOran = (yeterGun - gecen) / yeterGun;
        if (kalanOran > b.girdi.ayarlar.erkenTekrarEsigi) {
          sonuc.push(
            bulgu(
              b,
              'ERKEN_TEKRAR',
              'sari',
              `Hastaya ${g.tarih} tarihinde ${Math.round(yeterGun)} günlük ilaç verilmiş; ${Math.max(0, Math.round(yeterGun - gecen))} gün daha yetmesi gerekiyor.`,
            ),
          );
        }
      }
      return sonuc;
    },
  },
];

export const receteKurallari: ReceteKurali[] = [
  {
    id: 'RECETE_GECERLILIK',
    baslik: 'Reçete karşılama süresi içinde mi',
    calistir(girdi) {
      const gecen = gunFarki(girdi.recete.tarih, girdi.bugun);
      const sinir = girdi.ayarlar.receteGecerlilikGunu;
      if (gecen >= 0 && gecen <= sinir) return [];
      return [
        {
          kuralId: 'RECETE_GECERLILIK',
          seviye: 'kirmizi',
          mesaj:
            gecen < 0
              ? `Reçete tarihi (${girdi.recete.tarih}) karşılama tarihinden sonra.`
              : `Reçete ${gecen} gün önce yazılmış; karşılama süresi ${sinir} gün.`,
          kaynaklar: [{ tur: 'SUT', aciklama: 'Reçetelerin karşılanma süresi (motor ayarı: receteGecerlilikGunu)' }],
        },
      ];
    },
  },
  {
    id: 'UYARI_KODU',
    baslik: 'Girilen uyarı kodları reçetede var mı',
    calistir(girdi) {
      const receteKodlari = new Set((girdi.recete.receteUyariKodlari ?? []).map(normalize));
      return (girdi.recete.girilenUyariKodlari ?? [])
        .filter((k) => !receteKodlari.has(normalize(k)))
        .map((k) => ({
          kuralId: 'UYARI_KODU',
          seviye: 'kirmizi' as const,
          mesaj: `"${k}" uyarı kodu sisteme girilmiş ancak reçetede bulunmuyor. Reçetede olmayan uyarı kodunun girilmesi kesinti ve cezai işlem sebebidir.`,
          kaynaklar: [{ tur: 'Protokol' as const, aciklama: 'SGK – eczane sözleşmesi (protokol) hükümleri' }],
        }));
    },
  },
];
