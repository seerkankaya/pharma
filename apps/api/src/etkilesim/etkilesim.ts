import { normalize, type GecmisVerilis, type ReceteKalemi } from '@scalpiq/sut-motoru';

// Farmasötik bakım: ilaç-ilaç etkileşim kontrolü. Bulgular SUT sonucundan ayrı "klinik uyarı" olarak döner;
// reçetenin Medula'ya gönderimini kilitlemez, eczacının hastayı uyarması içindir.
//
// Etkileşim verisi lisanslı bir ilaç bilgi kaynağından gelmelidir. Burada yalnızca birkaç bilinen örnek çift
// "örnek" işaretiyle bulunur; eczacı kendi doğruladığı kuralları ekler.

export type EtkilesimSiddeti = 'kontrendike' | 'ciddi' | 'orta';
export const SIDDETLER: EtkilesimSiddeti[] = ['kontrendike', 'ciddi', 'orta'];

export interface EtkilesimKurali {
  id: string;
  /** Birinci taraftaki etken maddeler; herhangi biri ikinci taraftakilerden biriyle birlikteyse kural işler */
  a: string[];
  b: string[];
  siddet: EtkilesimSiddeti;
  mesaj: string;
  oneri?: string;
  kaynak: string;
  /** Doğrulanmamış örnek kural */
  ornek?: boolean;
  ekleyen?: string;
  tarih?: string;
}

export interface KlinikUyari {
  kuralId: string;
  siddet: EtkilesimSiddeti;
  mesaj: string;
  oneri?: string;
  kaynak: string;
  /** Etkileşen iki etken madde (reçetede yazıldığı gibi) */
  ilaclar: [string, string];
  /** İlaçlardan biri bu reçetede değil, hastanın yakın zamanda aldığı ilaçlardan */
  gecmistenMi?: boolean;
  ornekKural?: boolean;
}

const KUB = 'İlgili ürünlerin Kısa Ürün Bilgisi (KÜB), bölüm 4.5 "Diğer tıbbi ürünler ile etkileşimler"';

/** Bilinen, yaygın örnek etkileşimler. Lisanslı veri bağlanana kadar örnek olarak işaretlidir. */
export const ORNEK_ETKILESIMLER: EtkilesimKurali[] = [
  {
    id: 'ORNEK-VARFARIN-NSAII',
    a: ['VARFARIN'],
    b: ['ASETILSALISILIK ASIT', 'IBUPROFEN', 'NAPROKSEN', 'DIKLOFENAK'],
    siddet: 'ciddi',
    mesaj: 'Varfarin ile asetilsalisilik asit / NSAİİ birlikte kullanımı kanama riskini artırır.',
    oneri: 'Hekime danışın; INR takibi ve kanama belirtileri konusunda hastayı uyarın.',
    kaynak: KUB,
    ornek: true,
  },
  {
    id: 'ORNEK-KLARITROMISIN-STATIN',
    a: ['KLARITROMISIN'],
    b: ['SIMVASTATIN', 'LOVASTATIN'],
    siddet: 'kontrendike',
    mesaj: 'Klaritromisin simvastatin/lovastatin düzeyini yükseltir; miyopati ve rabdomiyoliz riski.',
    oneri: 'Birlikte kullanılmamalı; tedavi süresince statine ara verilmesi için hekime danışın.',
    kaynak: KUB,
    ornek: true,
  },
  {
    id: 'ORNEK-PDE5-NITRAT',
    a: ['SILDENAFIL', 'TADALAFIL', 'VARDENAFIL'],
    b: ['NITROGLISERIN', 'ISOSORBID MONONITRAT', 'ISOSORBID DINITRAT'],
    siddet: 'kontrendike',
    mesaj: 'PDE-5 inhibitörü ile nitratların birlikte kullanımı ağır hipotansiyona yol açabilir.',
    oneri: 'Birlikte kullanılmamalı.',
    kaynak: KUB,
    ornek: true,
  },
  {
    id: 'ORNEK-METOTREKSAT-TRIMETOPRIM',
    a: ['METOTREKSAT'],
    b: ['TRIMETOPRIM'],
    siddet: 'ciddi',
    mesaj: 'Metotreksat ile trimetoprim birlikte kemik iliği baskılanması riskini artırır.',
    oneri: 'Hekime danışın; kan sayımı takibi gerekebilir.',
    kaynak: KUB,
    ornek: true,
  },
  {
    id: 'ORNEK-ACE-SPIRONOLAKTON',
    a: ['RAMIPRIL', 'ENALAPRIL', 'LISINOPRIL', 'PERINDOPRIL'],
    b: ['SPIRONOLAKTON'],
    siddet: 'orta',
    mesaj: 'ACE inhibitörü ile spironolakton birlikte hiperkalemi riskini artırır.',
    oneri: 'Potasyum düzeyinin izlenmesi önerilir.',
    kaynak: KUB,
    ornek: true,
  },
  {
    id: 'ORNEK-KLOPIDOGREL-OMEPRAZOL',
    a: ['KLOPIDOGREL'],
    b: ['OMEPRAZOL', 'ESOMEPRAZOL'],
    siddet: 'orta',
    mesaj: 'Omeprazol/esomeprazol klopidogrelin etkin metabolitini azaltarak etkisini düşürebilir.',
    oneri: 'Hekime danışın; pantoprazol gibi alternatifler değerlendirilebilir.',
    kaynak: KUB,
    ornek: true,
  },
];

/** "SULFAMETOKSAZOL + TRIMETOPRIM" gibi kombinasyonları bileşenlerine ayırır. */
export const bilesenler = (etkenMadde: string) =>
  etkenMadde
    .split(/\s*(?:\+|,|\/)\s*|\s+VE\s+/i)
    .map(normalize)
    .filter(Boolean);

export function kuralDogrula(k: Partial<EtkilesimKurali> | undefined): string[] {
  const h: string[] = [];
  const liste = (x: unknown) => Array.isArray(x) && x.length > 0 && x.every((e) => typeof e === 'string' && e.trim());
  if (!liste(k?.a) || !liste(k?.b)) h.push('İki tarafta da en az bir etken madde olmalı');
  else if (k!.a!.some((x) => k!.b!.map(normalize).includes(normalize(x)))) h.push('Aynı etken madde iki tarafta birden olamaz');
  if (!SIDDETLER.includes(k?.siddet as EtkilesimSiddeti)) h.push(`Şiddet ${SIDDETLER.join(', ')} olmalı`);
  if (!k?.mesaj?.trim()) h.push('Etkileşimi açıklayın');
  if (!k?.kaynak?.trim()) h.push('Kaynağı yazın (KÜB, ilaç bilgi kaynağı vb.)');
  return h;
}

const SIRA: Record<EtkilesimSiddeti, number> = { kontrendike: 0, ciddi: 1, orta: 2 };

/**
 * Reçetedeki ilaçları birbirleriyle ve hastanın son günlerde aldığı ilaçlarla karşılaştırır.
 * Geçmişteki ilaçlar yalnızca reçetedekilerle karşılaştırılır; geçmişin kendi içindeki etkileşimleri raporlanmaz.
 */
export function etkilesimKontrol(
  kalemler: Pick<ReceteKalemi, 'etkenMadde'>[],
  kurallar: EtkilesimKurali[],
  gecmis: Pick<GecmisVerilis, 'etkenMadde'>[] = [],
): KlinikUyari[] {
  const ilaclar = [
    ...kalemler.map((k) => ({ ad: k.etkenMadde, bilesen: bilesenler(k.etkenMadde), gecmis: false })),
    ...gecmis.map((g) => ({ ad: g.etkenMadde, bilesen: bilesenler(g.etkenMadde), gecmis: true })),
  ];
  const uyarilar: KlinikUyari[] = [];
  const gorulen = new Set<string>();
  for (const kural of kurallar) {
    const a = new Set(kural.a.map(normalize));
    const b = new Set(kural.b.map(normalize));
    for (let i = 0; i < ilaclar.length; i++)
      for (let j = 0; j < ilaclar.length; j++) {
        const x = ilaclar[i]!;
        const y = ilaclar[j]!;
        if (i === j || (x.gecmis && y.gecmis)) continue;
        if (!x.bilesen.some((c) => a.has(c)) || !y.bilesen.some((c) => b.has(c))) continue;
        const anahtar = `${kural.id}|${normalize(x.ad)}|${normalize(y.ad)}`;
        if (gorulen.has(anahtar)) continue;
        gorulen.add(anahtar);
        uyarilar.push({
          kuralId: kural.id,
          siddet: kural.siddet,
          mesaj: kural.mesaj,
          ...(kural.oneri ? { oneri: kural.oneri } : {}),
          kaynak: kural.kaynak,
          ilaclar: [x.ad, y.ad],
          ...(x.gecmis || y.gecmis ? { gecmistenMi: true } : {}),
          ...(kural.ornek ? { ornekKural: true } : {}),
        });
      }
  }
  return uyarilar.sort((p, q) => SIRA[p.siddet] - SIRA[q.siddet] || p.kuralId.localeCompare(q.kuralId));
}
