// SUT TASLAK KURALLARI
// Sağlık Uygulama Tebliği'nin (SUT) 4.2 ilaç kullanım ilkelerinden, en çok kesinti görülen ilaç grupları için
// kodlanmış taslaklar. Taslak kural kontrolde KULLANILMAZ: kural yetkisi olan eczacı her birini güncel SUT
// metniyle karşılaştırıp onaylamalıdır.
//
// Metinler resmî kaynaktan (mevzuat.gov.tr, sgk.gov.tr) değil, SUT'u yeniden yayımlayan ilaç rehberi
// sitelerinden okunarak kodlandı. Bu nedenle her kuralın açıklaması kaynak fıkrayı özetler ve onaylanmadan
// önce resmî metinle karşılaştırılması gerekir. Motorun reçeteden denetleyemediği koşullar (LDL değeri,
// KMY ölçümü gibi) raporIcerigi'nde durur; eczacı her reçetede bunları raporda gördüğünü onaylar.

import type { IlacKurali, Kaynak } from '../types.js';

const BASLANGIC = '2026-01-01';
const KAYNAK_NOTU = 'Taslak: SUT metninin ilaç rehberi sitesindeki kopyasından kodlandı, resmî metinle karşılaştırılmadı.';

const sut = (madde: string, baslik: string): Kaynak => ({ tur: 'SUT', madde, aciklama: `${baslik}. ${KAYNAK_NOTU}` });

/** Aynı koşulların geçerli olduğu her etken madde için ayrı kural üretir. Kimlik: SUT-<grup>-<etken madde>. */
function grup(kod: string, etkenMaddeler: string[], ortak: Omit<IlacKurali, 'id' | 'etkenMadde' | 'gecerlilik'>): IlacKurali[] {
  return etkenMaddeler.map((etkenMadde) => ({
    id: `SUT-${kod}-${etkenMadde.replace(/[^A-Z0-9]+/g, '-')}`,
    etkenMadde,
    gecerlilik: { baslangic: BASLANGIC },
    ...structuredClone(ortak),
  }));
}

const DIYABET_UZMANLARI = ['Endokrinoloji', 'İç Hastalıkları', 'Çocuk Sağlığı ve Hastalıkları', 'Kardiyoloji'];

export const sutTaslakKurallari: IlacKurali[] = [
  // 4.2.28 Lipid düşürücü ilaçlar (statinler)
  ...grup('4.2.28', ['ATORVASTATIN', 'ROSUVASTATIN', 'SIMVASTATIN', 'PRAVASTATIN', 'FLUVASTATIN', 'PITAVASTATIN'], {
    aciklama:
      'Statinler uzman hekim raporuna dayanılarak tüm hekimlerce reçete edilir. Tedaviye başlarken raporda son 6 ay içinde en az 1 hafta arayla yapılmış iki lipid tetkiki ve risk grubuna göre LDL eşiği (190/160/130/70 mg/dL) yer almalıdır. Rapor yenilenirken yeni lipid tetkiki istenmez; 6 ay veya daha uzun ara verilen tedavide başlangıç koşulları yeniden aranır.',
    kaynak: sut('4.2.28', 'Lipid düşürücü ilaçların kullanım ilkeleri'),
    raporGerekli: true,
    raporTuru: 'uzman',
    raporIcerigi: [
      'tedavi başlangıcında son 6 ay içinde en az 1 hafta arayla yapılmış iki lipid tetkikinin LDL değerleri',
      'LDL eşiğini belirleyen risk faktörleri (hipertansiyon, ailede erken kardiyovasküler hastalık, 65 yaş üstü) ya da damar hastalığı veya diyabet',
    ],
  }),

  // 4.2.15.D Yeni oral antikoagülanlar
  ...grup('4.2.15.D', ['DABIGATRAN', 'RIVAROKSABAN', 'APIKSABAN', 'EDOKSABAN'], {
    aciklama:
      'Non-valvüler atriyal fibrilasyonda; en az biri kardiyoloji uzmanı olmak üzere kardiyoloji, iç hastalıkları, göğüs hastalıkları, kalp ve damar cerrahisi ve nöroloji uzmanlarından en az üçünün yer aldığı sağlık kurulu raporuyla bu uzmanlarca reçete edilir. Derin ven trombozu ve pulmoner emboli endikasyonu da vardır. Elektif kalça/diz protezi sonrası profilakside ortopedi uzmanı raporu ve kutu sınırları ayrıca düzenlenmiştir; bu taslak o istisnayı içermez. Rapor süresini resmî metinden doğrulayın.',
    kaynak: sut('4.2.15.D', 'Yeni oral antikoagülanlar'),
    raporGerekli: true,
    raporTuru: 'saglik-kurulu',
    raporDuzenleyenBranslar: ['Kardiyoloji', 'İç Hastalıkları', 'Göğüs Hastalıkları', 'Kalp ve Damar Cerrahisi', 'Nöroloji'],
    receteEdenBranslar: ['Kardiyoloji', 'İç Hastalıkları', 'Göğüs Hastalıkları', 'Kalp ve Damar Cerrahisi', 'Nöroloji'],
    raporIcerigi: [
      'non-valvüler AF ve prospektüsteki risk faktörlerinden en az biri (ya da DVT/PE tanısı)',
      'ekokardiyografiyle romatizmal veya ciddi mitral kapak hastalığı ve protez kapak olmadığı',
      'varfarinden geçişte: en az 2 ay varfarin ve son 5 INR ölçümünün en az 3’ünde 2-3 aralığının tutturulamadığı ya da varfarin altında serebrovasküler olay',
      'kurulda en az bir kardiyoloji uzmanı ve en az üç uzman',
    ],
  }),

  // 4.2.38 Diyabet: DPP-4 inhibitörleri
  ...grup('4.2.38', ['SITAGLIPTIN', 'VILDAGLIPTIN', 'SAKSAGLIPTIN', 'LINAGLIPTIN', 'ALOGLIPTIN'], {
    aciklama:
      'Metformin ve/veya sülfonilürelerin maksimum tolere edilebilir dozlarında yeterli glisemik kontrol sağlanamayan hastalarda; endokrinoloji ve iç hastalıkları uzmanlarınca veya bu uzmanların düzenlediği uzman hekim raporuyla tüm hekimlerce reçete edilir. Alogliptinin 12,5 mg tek başına formu yalnızca kronik böbrek yetmezliğinde, günde en fazla 12,5 mg.',
    kaynak: sut('4.2.38', 'Diyabet tedavisinde ilaç kullanım ilkeleri'),
    raporGerekli: true,
    raporTuru: 'uzman',
    raporDuzenleyenBranslar: ['Endokrinoloji', 'İç Hastalıkları'],
    raporsuzYazabilenBranslar: ['Endokrinoloji', 'İç Hastalıkları'],
    raporIcerigi: ['metformin ve/veya sülfonilürenin maksimum tolere dozunda yeterli glisemik kontrol sağlanamadığı'],
  }),

  // 4.2.38 Diyabet: analog insülinler ve pioglitazon
  ...grup(
    '4.2.38',
    ['INSULIN GLARJIN', 'INSULIN DETEMIR', 'INSULIN DEGLUDEK', 'INSULIN ASPART', 'INSULIN LISPRO', 'INSULIN GLULISIN', 'PIOGLITAZON'],
    {
      aciklama:
        'Analog insülinler, pioglitazon ve kombinasyonları endokrinoloji, iç hastalıkları, çocuk sağlığı ve hastalıkları ve kardiyoloji uzmanlarınca veya bu uzmanların düzenlediği uzman hekim raporuyla tüm hekimlerce reçete edilir.',
      kaynak: sut('4.2.38', 'Diyabet tedavisinde ilaç kullanım ilkeleri'),
      raporGerekli: true,
      raporTuru: 'uzman',
      raporDuzenleyenBranslar: DIYABET_UZMANLARI,
      raporsuzYazabilenBranslar: DIYABET_UZMANLARI,
    },
  ),

  // 4.2.38 Diyabet: glinidler
  ...grup('4.2.38', ['REPAGLINID', 'NATEGLINID'], {
    aciklama:
      'Repaglinid, nateglinid ve diğer oral antidiyabetik kombinasyonları endokrinoloji, iç hastalıkları, çocuk sağlığı ve hastalıkları, kardiyoloji ve aile hekimliği uzmanlarınca veya bu uzmanların düzenlediği uzman hekim raporuyla tüm hekimlerce reçete edilir.',
    kaynak: sut('4.2.38', 'Diyabet tedavisinde ilaç kullanım ilkeleri'),
    raporGerekli: true,
    raporTuru: 'uzman',
    raporDuzenleyenBranslar: [...DIYABET_UZMANLARI, 'Aile Hekimliği'],
    raporsuzYazabilenBranslar: [...DIYABET_UZMANLARI, 'Aile Hekimliği'],
  }),

  // 4.2.24.A Astım: lökotrien reseptör antagonistleri
  ...grup('4.2.24.A', ['MONTELUKAST', 'ZAFIRLUKAST'], {
    aciklama:
      'Montelukast ve zafirlukast iç hastalıkları, çocuk sağlığı ve hastalıkları, göğüs hastalıkları ve alerji uzmanlarınca veya bu uzmanlardan birinin düzenlediği uzman hekim raporuyla diğer hekimlerce reçete edilir. Antihistaminikle kombinasyonları (ürtiker) ayrı düzenlenmiştir.',
    kaynak: sut('4.2.24.A', 'Astım tedavisinde ilaç kullanım ilkeleri'),
    raporGerekli: true,
    raporTuru: 'uzman',
    raporDuzenleyenBranslar: ['İç Hastalıkları', 'Çocuk Sağlığı ve Hastalıkları', 'Göğüs Hastalıkları', 'Alerji', 'İmmünoloji ve Alerji'],
    raporsuzYazabilenBranslar: ['İç Hastalıkları', 'Çocuk Sağlığı ve Hastalıkları', 'Göğüs Hastalıkları', 'Alerji', 'İmmünoloji ve Alerji'],
  }),

  // EK-4/F Demans ilaçları
  ...grup('EK-4-F', ['DONEPEZIL', 'RIVASTIGMIN', 'GALANTAMIN', 'MEMANTIN'], {
    aciklama:
      'Demans ilaçları nöroloji, geriatri ve psikiyatri uzmanlarınca veya bu uzmanlardan birinin düzenlediği uzman hekim raporuyla diğer hekimlerce reçete edilir. Ginkgo içeren kombinasyonlar ayrı düzenlenmiştir.',
    kaynak: { tur: 'SUT', madde: 'EK-4/F', aciklama: `Ayakta tedavide sağlık kurulu/uzman hekim raporu ile verilebilecek ilaçlar. ${KAYNAK_NOTU}` },
    raporGerekli: true,
    raporDuzenleyenBranslar: ['Nöroloji', 'Geriatri', 'İç Hastalıkları Geriatri', 'Psikiyatri'],
    raporsuzYazabilenBranslar: ['Nöroloji', 'Geriatri', 'İç Hastalıkları Geriatri', 'Psikiyatri'],
  }),

  // 4.2.17 Osteoporoz
  ...grup('4.2.17', ['ALENDRONAT', 'RISEDRONAT', 'IBANDRONAT', 'ZOLEDRONIK ASIT', 'RALOKSIFEN', 'DENOSUMAB'], {
    aciklama:
      'Bisfosfonatlar, raloksifen, kalsitonin, stronsiyum ranelat ve denosumab tedavi süresinin belirtildiği sağlık raporuyla reçete edilir; osteoporozda rapor süresi 2 yıldır. Tedavi, rapor tarihinden önceki son 2 yıl içinde yapılan KMY ölçümüyle planlanır. Bu ilaçlar birlikte kullanılırsa yalnızca birinin bedeli ödenir. Juvenil osteoporoz ve Paget hastalığında rapor süresi 1 yıldır.',
    kaynak: sut('4.2.17', 'Osteoporoz ve Paget hastalığında ilaç kullanım ilkeleri'),
    raporGerekli: true,
    raporAzamiGun: 731,
    raporIcerigi: ['rapor tarihinden önceki son 2 yıl içinde yapılmış KMY ölçümü ve sonucu', 'tedavi süresi'],
  }),
];
