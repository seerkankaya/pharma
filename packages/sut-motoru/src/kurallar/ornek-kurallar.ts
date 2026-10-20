// ÖRNEK KURAL KİTAPLIĞI
// Buradaki kayıtlar motorun nasıl çalıştığını göstermek ve test etmek içindir.
// Etken maddeler, madde numaraları ve koşullar GERÇEK SUT HÜKÜMLERİ DEĞİLDİR.
// Gerçek kural kitaplığı, güncel SUT metninden uzman eczacı onayıyla kodlanmalıdır.

import type { IlacKurali, MotorAyarlari } from '../types.js';

export const ornekIlacKurallari: IlacKurali[] = [
  {
    id: 'ORNEK-KARDIYO-1',
    etkenMadde: 'ÖRNEKMADDE-A',
    aciklama: 'Koroner arter hastalığında, kardiyoloji uzmanının düzenlediği uzman hekim raporuyla ödenir.',
    kaynak: { tur: 'SUT', madde: 'ÖRNEK 4.2.X', aciklama: 'Örnek hüküm – doğrulanmadı', resmiGazete: { tarih: '2026-01-01' } },
    gecerlilik: { baslangic: '2026-01-01' },
    ornek: true,
    raporGerekli: true,
    raporTuru: 'uzman',
    raporDuzenleyenBranslar: ['Kardiyoloji'],
    izinliTanilar: ['I25', 'I21'],
    maksGunlukDoz: 1,
    maksTedaviGunu: 90,
  },
  {
    id: 'ORNEK-ONKO-1',
    etkenMadde: 'ÖRNEKMADDE-B',
    aciklama: 'Sağlık kurulu raporuyla, yalnızca onkoloji uzmanlarınca reçete edilir.',
    kaynak: { tur: 'SUT', madde: 'ÖRNEK 4.2.Y', aciklama: 'Örnek hüküm – doğrulanmadı', resmiGazete: { tarih: '2026-01-01' } },
    gecerlilik: { baslangic: '2026-01-01' },
    ornek: true,
    raporGerekli: true,
    raporTuru: 'saglik-kurulu',
    raporDuzenleyenBranslar: ['Tıbbi Onkoloji'],
    receteEdenBranslar: ['Tıbbi Onkoloji'],
  },
  {
    id: 'ORNEK-PSIKIYATRI-1',
    etkenMadde: 'ÖRNEKMADDE-C',
    aciklama: 'Kırmızı reçete ile yazılır.',
    kaynak: { tur: 'Mevzuat', madde: 'ÖRNEK', aciklama: 'Örnek hüküm – doğrulanmadı' },
    gecerlilik: { baslangic: '2026-01-01' },
    ornek: true,
    receteTuru: 'kirmizi',
  },
  {
    id: 'ORNEK-GENEL-1',
    etkenMadde: 'ÖRNEKMADDE-D',
    aciklama: 'Raporsuz, tüm hekimlerce reçete edilebilir.',
    kaynak: { tur: 'SUT', madde: 'ÖRNEK 4.1.Z', aciklama: 'Örnek hüküm – doğrulanmadı' },
    gecerlilik: { baslangic: '2026-01-01' },
    ornek: true,
  },
];

/**
 * Varsayılan motor ayarları.
 * receteGecerlilikGunu: SUT'taki güncel karşılama süresiyle doğrulanmadan canlıda kullanılmamalıdır.
 */
export const varsayilanAyarlar: MotorAyarlari = {
  receteGecerlilikGunu: 3,
  erkenTekrarEsigi: 0.2,
};
