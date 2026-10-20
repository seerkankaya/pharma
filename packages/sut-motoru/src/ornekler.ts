// Demo ve testler için örnek veri. Barkodlar ve ilaç adları kurgusaldır.

import { haritaListesi } from './ek4a-bellek.js';
import type { Recete } from './types.js';

export const ornekEk4a = haritaListesi('2026-10-15', [
  { kamuNo: 'A90001', barkod: '8690000000011', ad: 'KARDIOX 75 MG 28 TABLET', eskiBarkodlar: ['8690000000004'] },
  { kamuNo: 'A90002', barkod: '8690000000028', ad: 'ONKOMAB 100 MG FLAKON' },
  { kamuNo: 'A90003', barkod: '8690000000035', ad: 'PSIKOLAN 10 MG 30 TABLET' },
  { kamuNo: 'A90004', barkod: '8690000000042', ad: 'GENELOL 500 MG 20 TABLET' },
]);

const kardiyoRaporu = {
  no: 'R-1001',
  tur: 'uzman' as const,
  baslangic: '2026-06-01',
  bitis: '2027-05-31',
  duzenleyenBranslar: ['Kardiyoloji'],
  tanilar: ['I25.1'],
  ilaclar: [{ etkenMadde: 'ÖRNEKMADDE-A', gunlukDoz: 1, birim: 'tablet' }],
};

export const ornekReceteler: { baslik: string; recete: Recete }[] = [
  {
    baslik: 'Uygun reçete (yeşil)',
    recete: {
      no: 'E-1001',
      tarih: '2026-10-20',
      tur: 'normal',
      hekim: { ad: 'Dr. Ayşe Demir', brans: 'Kardiyoloji' },
      tanilar: ['I25.1'],
      kalemler: [
        { barkod: '8690000000011', ad: 'KARDIOX 75 MG 28 TABLET', etkenMadde: 'ÖRNEKMADDE-A', adet: 1, gunlukDoz: 1, birim: 'tablet', kutuIcerik: 28 },
      ],
      raporlar: [kardiyoRaporu],
    },
  },
  {
    baslik: 'Raporu süresi dolmuş, doz aşımı (kırmızı)',
    recete: {
      no: 'E-1002',
      tarih: '2026-10-20',
      tur: 'normal',
      hekim: { ad: 'Dr. Mehmet Kaya', brans: 'Aile Hekimliği' },
      tanilar: ['I25.1'],
      kalemler: [
        { barkod: '8690000000011', ad: 'KARDIOX 75 MG 28 TABLET', etkenMadde: 'ÖRNEKMADDE-A', adet: 1, gunlukDoz: 2, birim: 'tablet', kutuIcerik: 28 },
      ],
      raporlar: [{ ...kardiyoRaporu, no: 'R-0900', baslangic: '2025-06-01', bitis: '2026-05-31' }],
    },
  },
  {
    baslik: 'Yanlış rapor türü ve branş (kırmızı)',
    recete: {
      no: 'E-1003',
      tarih: '2026-10-20',
      tur: 'normal',
      hekim: { ad: 'Dr. Zeynep Ak', brans: 'İç Hastalıkları' },
      tanilar: ['C50.9'],
      kalemler: [{ barkod: '8690000000028', ad: 'ONKOMAB 100 MG FLAKON', etkenMadde: 'ÖRNEKMADDE-B', adet: 1 }],
      raporlar: [
        {
          no: 'R-2001',
          tur: 'uzman',
          baslangic: '2026-09-01',
          bitis: '2027-02-28',
          duzenleyenBranslar: ['İç Hastalıkları'],
          tanilar: ['C50.9'],
          ilaclar: [{ etkenMadde: 'ÖRNEKMADDE-B' }],
        },
      ],
    },
  },
  {
    baslik: 'Erken tekrar ve tanımsız ilaç (sarı)',
    recete: {
      no: 'E-1004',
      tarih: '2026-10-20',
      tur: 'normal',
      hekim: { ad: 'Dr. Ayşe Demir', brans: 'Kardiyoloji' },
      tanilar: ['I25.1'],
      kalemler: [
        { barkod: '8690000000011', ad: 'KARDIOX 75 MG 28 TABLET', etkenMadde: 'ÖRNEKMADDE-A', adet: 1, gunlukDoz: 1, birim: 'tablet', kutuIcerik: 28 },
        { barkod: '8690000000042', ad: 'GENELOL 500 MG 20 TABLET', etkenMadde: 'TANIMSIZ-MADDE', adet: 1 },
      ],
      raporlar: [kardiyoRaporu],
    },
  },
  {
    baslik: 'Listede olmayan barkod, yanlış reçete türü, olmayan uyarı kodu (kırmızı)',
    recete: {
      no: 'E-1005',
      tarih: '2026-10-20',
      tur: 'normal',
      hekim: { ad: 'Dr. Can Er', brans: 'Psikiyatri' },
      tanilar: ['F32.1'],
      kalemler: [
        { barkod: '8690000000035', ad: 'PSIKOLAN 10 MG 30 TABLET', etkenMadde: 'ÖRNEKMADDE-C', adet: 1 },
        { barkod: '8699999999999', ad: 'BILINMEYEN URUN', etkenMadde: 'ÖRNEKMADDE-D', adet: 1 },
      ],
      raporlar: [],
      girilenUyariKodlari: ['ÖZEL-UYARI-1'],
      receteUyariKodlari: [],
    },
  },
];

/** E-1004 için kullanılan örnek hasta geçmişi: 10 gün önce 28 günlük ilaç verilmiş. */
export const ornekGecmis = {
  'E-1004': [{ etkenMadde: 'ÖRNEKMADDE-A', tarih: '2026-10-10', adet: 1, kutuIcerik: 28, gunlukDoz: 1 }],
} as const;
