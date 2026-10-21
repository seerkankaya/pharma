// SUT TASLAK KURALLARI
// Sağlık Uygulama Tebliği'nin (SUT) 4.2 ilaç kullanım ilkelerinden, en çok kesinti görülen ilaç grupları için
// kodlanmış taslaklar. Taslak kural kontrolde KULLANILMAZ: kural yetkisi olan eczacı her birini okuyup onaylamalıdır.
//
// Metinler, 02.10.2026 tarihli değişiklik tebliği işlenmiş güncel 2013 SUT metninden (SGK'nın yayımladığı
// .docx) kodlandı. Her kuralın açıklaması kaynak fıkrayı özetler. Motorun reçeteden denetleyemediği koşullar
// (LDL değeri, KMY ölçümü gibi) raporIcerigi'nde durur; eczacı her reçetede bunları raporda gördüğünü onaylar.

import type { IlacKurali, Kaynak } from '../types.js';

const BASLANGIC = '2026-01-01';
/** Taslakların kodlandığı SUT metninin değişiklik tarihi; onaylı kuralın yeni sürüm taslağı bu ekle adlandırılır. */
export const SUT_SURUMU = '2026-10-02';
const KAYNAK_NOTU = 'Güncel SUT metninden (02.10.2026 değişiklik tebliği işlenmiş) kodlandı.';

const sut = (madde: string, baslik: string): Kaynak => ({ tur: 'SUT', madde, aciklama: `${baslik}. ${KAYNAK_NOTU}` });

/**
 * Aynı koşulların geçerli olduğu her etken madde için ayrı kural üretir. Kimlik: SUT-<grup>-<etken madde>.
 * Kimlikler eczanelerde kayıtlı taslaklarla eşleşir; kaynak madde numarası inceltilse de kimlik değiştirilmez.
 */
function grup(kod: string, etkenMaddeler: string[], ortak: Omit<IlacKurali, 'id' | 'etkenMadde' | 'gecerlilik'>): IlacKurali[] {
  return etkenMaddeler.map((etkenMadde) => ({
    id: `SUT-${kod}-${etkenMadde.replace(/[^A-Z0-9]+/g, '-')}`,
    etkenMadde,
    gecerlilik: { baslangic: BASLANGIC },
    ...structuredClone(ortak),
  }));
}

const DIYABET_UZMANLARI = ['Endokrinoloji', 'İç Hastalıkları', 'Çocuk Sağlığı ve Hastalıkları', 'Kardiyoloji'];
const DPP4_SGLT2_UZMANLARI = ['Endokrinoloji', 'İç Hastalıkları'];
const LIPID_UZMANLARI = ['Kardiyoloji', 'Kalp ve Damar Cerrahisi', 'Endokrinoloji', 'Geriatri', 'Nöroloji', 'İç Hastalıkları'];
const NOAK_UZMANLARI = [
  'Kardiyoloji',
  'İç Hastalıkları',
  'Göğüs Hastalıkları',
  'Kalp ve Damar Cerrahisi',
  'Radyoloji',
  'Beyin ve Sinir Cerrahisi',
  'Nöroloji',
];
const OSTEOPOROZ_UZMANLARI = [
  'İç Hastalıkları',
  'Fiziksel Tıp ve Rehabilitasyon',
  'Ortopedi ve Travmatoloji',
  'Romatoloji',
  'Tıbbi Ekoloji ve Hidroklimatoloji',
  'Kadın Hastalıkları ve Doğum',
  'Endokrinoloji',
];
const STATIN_RAPOR_ICERIGI = [
  'tedavi başlangıcında son 6 ay içinde en az 1 hafta arayla yapılmış iki lipid tetkikinin LDL değerleri (rapor yenilenirken yeni tetkik istenmez)',
  'LDL eşiğini belirleyen durum: >190; >160 ve iki ek risk faktörü; >130 ve üç ek risk faktörü (hipertansiyon, ailede erken kardiyovasküler hastalık, 65 yaş ve üstü); ya da >70 ve diyabet, AKS, geçirilmiş Mİ veya inme, koroner, periferik veya karotid arter hastalığı, abdominal aort anevrizması',
];

/** 4.2.28.A-1 (4): yüksek dozlar için raporu düzenleyebilen branşlar sınırlı; doz eşiği etken maddeye göre değişir. */
function statin(etkenMadde: string, yuksekDozMg?: number): IlacKurali[] {
  return grup('4.2.28', [etkenMadde], {
    aciklama:
      'Statinler uzman hekim raporuna dayanılarak tüm hekimlerce reçete edilir. İlk raporda son 6 ay içinde en az bir hafta arayla yapılmış iki lipid tetkiki ve LDL eşiği yazılı olmalı; rapor yenilenirken yeni tetkik istenmez, 6 ay veya daha uzun ara verilmişse başlangıç koşulları yeniden aranır.' +
      (yuksekDozMg
        ? ` ${yuksekDozMg} mg ve üzeri dozların raporunu yalnızca kardiyoloji, kalp ve damar cerrahisi, endokrinoloji, geriatri, nöroloji veya iç hastalıkları uzmanı düzenler; ilk 24 aydan sonraki devam raporlarını aile hekimliği uzmanı da düzenleyebilir.`
        : ''),
    kaynak: sut('4.2.28.A-1', 'Lipid düşürücü ilaçların kullanım ilkeleri, statinler (yetişkinlerde)'),
    raporGerekli: true,
    raporTuru: 'uzman',
    raporIcerigi: STATIN_RAPOR_ICERIGI,
    ...(yuksekDozMg
      ? { yuksekDoz: { asgariMg: yuksekDozMg, raporDuzenleyenBranslar: LIPID_UZMANLARI, devamRaporuBranslari: ['Aile Hekimliği'] } }
      : {}),
  });
}

export const sutTaslakKurallari: IlacKurali[] = [
  // 4.2.28.A Lipid düşürücü ilaçlar (statinler). Çocuklarda (4.2.28.A-2) ayrı koşullar vardır, bu taslak yetişkinler içindir.
  ...statin('ATORVASTATIN', 40),
  ...statin('ROSUVASTATIN', 20),
  ...statin('SIMVASTATIN', 40),
  ...statin('PRAVASTATIN', 40),
  ...statin('FLUVASTATIN', 80),
  ...statin('PITAVASTATIN'),

  // 4.2.28.C Ezetimib
  ...grup('4.2.28.C', ['EZETIMIB'], {
    aciklama:
      'Ezetimib içeren ürünler, en az 6 ay statin kullanmasına rağmen LDL 100 mg/dL üzerinde kalan ya da karaciğer enzimi veya CK yüksekliği nedeniyle statin kullanamayan hastalarda, bu durumun belgelendiği uzman hekim raporuyla tüm hekimlerce reçete edilir.',
    kaynak: sut('4.2.28.C', 'Ezetimib içeren ürünler ve safra asidi tutucular'),
    raporGerekli: true,
    raporTuru: 'uzman',
    raporDuzenleyenBranslar: ['Kardiyoloji', 'İç Hastalıkları', 'Nöroloji', 'Kalp ve Damar Cerrahisi'],
    raporIcerigi: [
      'en az 6 ay statin tedavisine rağmen LDL değerinin 100 mg/dL üzerinde kaldığı ya da AST/ALT normalin 3 katı veya CK normalin 2 katı üzerine çıktığı için statin kullanılamadığı',
    ],
  }),

  // 4.2.15.D Yeni oral antikoagülanlar
  ...grup('4.2.15.D', ['DABIGATRAN', 'RIVAROKSABAN', 'APIKSABAN', 'EDOKSABAN'], {
    aciklama:
      'Non-valvüler AF (4.2.15.D-1) ve DVT/PE (4.2.15.D-2) endikasyonlarında 1 yıl süreli sağlık kurulu raporuyla, raporu düzenleyebilen uzmanlarca reçete edilir. İlk iki rapordan (24 ay) sonra devam raporu bu branşlardan birinin uzman hekim raporu olabilir ve aile hekimleri de reçete edebilir. Birbirleriyle kombine kullanımı ödenmez. Elektif kalça/diz protezi sonrası profilaksi bu taslakta yoktur.',
    kaynak: sut('4.2.15.D', 'Dabigatran, rivaroksaban, edoksaban ve apiksaban'),
    raporGerekli: true,
    raporAzamiGun: 366,
    raporDuzenleyenBranslar: NOAK_UZMANLARI,
    receteEdenBranslar: [...NOAK_UZMANLARI, 'Aile Hekimliği'],
    raporIcerigi: [
      'ilk 24 ay sağlık kurulu raporu: AF’de en az biri kardiyoloji veya nöroloji olmak üzere en az üç uzman; DVT/PE’de bu dallardan en az üç uzman. Sonraki devam raporu uzman hekim raporu olabilir',
      'AF’de: orta-ciddi mitral darlık ve mekanik protez kapak olmadığı ve inme/TİA öyküsü, 75 yaş ve üstü, NYHA ≥II kalp yetmezliği, diyabet veya hipertansiyondan en az biri',
      'varfarinden geçişte: en az 2 ay varfarin ve haftalık son 5 INR ölçümünün en az 3’ünde 2-3 tutturulamadığı ya da varfarin altında serebrovasküler olay (DVT/PE’de aktif kanser, homozigot trombofili, tekrarlayan idiopatik PE veya immobilitede varfarin şartı aranmaz)',
      'aile hekimi reçete ettiyse: raporun ilk 24 aydan sonraki devam raporu olduğu',
    ],
  }),

  // 4.2.15.A Klopidogrel
  ...grup('4.2.15', ['KLOPIDOGREL'], {
    aciklama:
      'Kapak biyoprotezi, anjiyografik koroner arter hastalığı, tıkayıcı periferik arter hastalığı veya iskemik inmede 12 ayı geçmeyen uzman hekim raporuyla tüm hekimlerce reçete edilir; ilk 24 aydan sonra raporu aile hekimliği uzmanı da düzenleyebilir. Stent ve akut koroner sendromda taburculuktan sonra 4 haftayı geçmemek üzere kardiyoloji, kalp ve damar cerrahisi, iç hastalıkları ve acil tıp uzmanları raporsuz yazabilir.',
    kaynak: sut('4.2.15.A', 'Klopidogrel (kombinasyonları dahil)'),
    raporGerekli: true,
    raporTuru: 'uzman',
    raporAzamiGun: 366,
    raporDuzenleyenBranslar: ['Kardiyoloji', 'İç Hastalıkları', 'Nöroloji', 'Kalp ve Damar Cerrahisi', 'Acil Tıp', 'Aile Hekimliği'],
    raporsuzYazabilenBranslar: ['Kardiyoloji', 'Kalp ve Damar Cerrahisi', 'İç Hastalıkları', 'Acil Tıp'],
    raporsuzKosul:
      'stent takılması ya da akut koroner sendrom (STEMI, NSTEMI, anstabil angina) nedeniyle yatış ve taburculuktan itibaren en fazla 4 haftalık doz',
    raporIcerigi: [
      'kullanım süresi (en fazla 12 ay) ve endikasyon: kapak biyoprotezi, anjiyografik koroner arter hastalığı, tıkayıcı periferik arter hastalığı, iskemik inme ya da AKS',
      'aile hekimliği uzmanı düzenlediyse: ilk iki rapordan (24 ay) sonraki devam raporu olduğu',
    ],
  }),

  // 4.2.15.Ç Prasugrel, 4.2.15.E Tikagrelor
  ...grup('4.2.15', ['PRASUGREL'], {
    aciklama:
      'Perkütan girişim kararı alınan STEMI/NSTEMI’li (75 yaş altı, 60 kg üstü, serebrovasküler olay öyküsü olmayan) ya da klopidogrel altında stent trombozu gelişen AKS hastalarında; kardiyoloji veya kalp ve damar cerrahisi uzmanlarınca raporsuz 4 haftalık doz, sonrasında en az bir kardiyoloji veya kalp ve damar cerrahisi uzmanının yer aldığı 1 yıl süreli sağlık kurulu raporuyla bu hekimlerce veya iç hastalıkları uzmanlarınca reçete edilir. Tedavi süresi 1 yıldır.',
    kaynak: sut('4.2.15.Ç', 'Prasugrel'),
    raporGerekli: true,
    raporTuru: 'saglik-kurulu',
    raporAzamiGun: 366,
    raporDuzenleyenBranslar: ['Kardiyoloji', 'Kalp ve Damar Cerrahisi'],
    raporsuzYazabilenBranslar: ['Kardiyoloji', 'Kalp ve Damar Cerrahisi'],
    raporsuzKosul: 'akut koroner sendrom sonrası en fazla 4 haftalık doz',
    receteEdenBranslar: ['Kardiyoloji', 'Kalp ve Damar Cerrahisi', 'İç Hastalıkları'],
    raporIcerigi: ['75 yaş altı, 60 kg üstü, serebrovasküler olay öyküsü olmayan ve PKG kararı alınmış STEMI/NSTEMI ya da klopidogrel altında stent trombozu'],
  }),
  ...grup('4.2.15', ['TIKAGRELOR'], {
    aciklama:
      'STEMI veya NSTEMI’li, son 72 saatte fibrinolitik almamış ve varfarin kullanmayan hastalarda; kardiyoloji veya kalp ve damar cerrahisi uzmanlarınca raporsuz 4 haftalık doz, sonrasında bu dallardan birinin yer aldığı 1 yıl süreli sağlık kurulu raporuyla kardiyoloji, kalp ve damar cerrahisi veya iç hastalıkları uzmanlarınca reçete edilir. Tedavi süresi 1 yıldır (13 kutu).',
    kaynak: sut('4.2.15.E', 'Tikagrelor'),
    raporGerekli: true,
    raporTuru: 'saglik-kurulu',
    raporAzamiGun: 366,
    raporDuzenleyenBranslar: ['Kardiyoloji', 'Kalp ve Damar Cerrahisi'],
    raporsuzYazabilenBranslar: ['Kardiyoloji', 'Kalp ve Damar Cerrahisi'],
    raporsuzKosul: 'akut koroner sendrom sonrası en fazla 4 haftalık doz',
    receteEdenBranslar: ['Kardiyoloji', 'Kalp ve Damar Cerrahisi', 'İç Hastalıkları'],
    raporIcerigi: [
      'STEMI veya NSTEMI tanısı ve EKG/troponin bulguları',
      'son 72 saatte fibrinolitik tedavi uygulanmadığı ve hastanın varfarin kullanmadığı',
      'toplamda 1 yılı (13 kutu) aşmadığı',
    ],
  }),

  // 4.2.38 Diyabet: DPP-4 inhibitörleri
  ...grup('4.2.38', ['SITAGLIPTIN', 'VILDAGLIPTIN', 'SAKSAGLIPTIN', 'LINAGLIPTIN', 'ALOGLIPTIN'], {
    aciklama:
      'DPP-4 inhibitörleri ve diğer oral antidiyabetiklerle kombinasyonları; metformin ve/veya sülfonilürelerin maksimum tolere edilebilir dozlarında yeterli glisemik kontrol sağlanamayan hastalarda endokrinoloji ve iç hastalıkları uzmanlarınca veya bu uzmanların düzenlediği uzman hekim raporuyla tüm hekimlerce reçete edilir. Saksagliptinin 2,5 mg ve alogliptinin 12,5 mg tek başına formları yalnızca kronik böbrek yetmezliğinde. GLP-1 analoglarıyla birlikte kullanımı ödenmez.',
    kaynak: sut('4.2.38', 'Diyabet tedavisinde ilaç kullanım ilkeleri'),
    raporGerekli: true,
    raporTuru: 'uzman',
    raporDuzenleyenBranslar: DPP4_SGLT2_UZMANLARI,
    raporsuzYazabilenBranslar: DPP4_SGLT2_UZMANLARI,
    raporIcerigi: ['metformin ve/veya sülfonilürenin maksimum tolere dozunda yeterli glisemik kontrol sağlanamadığı'],
  }),

  // 4.2.38 Diyabet: SGLT2 inhibitörleri
  ...grup('4.2.38', ['DAPAGLIFLOZIN', 'EMPAGLIFLOZIN'], {
    aciklama:
      'SGLT2 inhibitörleri ve diğer oral antidiyabetiklerle kombinasyonları; metformin ve/veya sülfonilürelerin maksimum tolere edilebilir dozlarında yeterli glisemik kontrol sağlanamayan tip 2 diyabet hastalarında endokrinoloji ve iç hastalıkları uzmanlarınca veya bu uzmanların düzenlediği uzman hekim raporuyla tüm hekimlerce reçete edilir. Kalp yetmezliği ve kronik böbrek hastalığı endikasyonları bu taslakta yoktur.',
    kaynak: sut('4.2.38', 'Diyabet tedavisinde ilaç kullanım ilkeleri'),
    raporGerekli: true,
    raporTuru: 'uzman',
    raporDuzenleyenBranslar: DPP4_SGLT2_UZMANLARI,
    raporsuzYazabilenBranslar: DPP4_SGLT2_UZMANLARI,
    raporIcerigi: ['tip 2 diyabet ve metformin ve/veya sülfonilürenin maksimum tolere dozunda yeterli glisemik kontrol sağlanamadığı'],
  }),

  // 4.2.38 Diyabet: analog insülinler ve pioglitazon
  ...grup(
    '4.2.38',
    ['INSULIN GLARJIN', 'INSULIN DETEMIR', 'INSULIN DEGLUDEK', 'INSULIN ASPART', 'INSULIN LISPRO', 'INSULIN GLULISIN', 'PIOGLITAZON'],
    {
      aciklama:
        'Analog insülinler, pioglitazon ve kombinasyonları endokrinoloji, iç hastalıkları, çocuk sağlığı ve hastalıkları ve kardiyoloji uzmanlarınca veya bu uzmanların düzenlediği uzman hekim raporuyla tüm hekimlerce reçete edilir. İnsülin degludek + insülin aspart kombinasyonu ve insülin glarjin + liksisenatid kombinasyonu ayrı koşullara bağlıdır, bu taslakta yoktur.',
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
      'Repaglinid (kombinasyonları dahil), nateglinid ve diğer oral antidiyabetiklerin kombine preparatları endokrinoloji, iç hastalıkları, çocuk sağlığı ve hastalıkları, kardiyoloji ve aile hekimliği uzmanlarınca veya bu uzmanların düzenlediği uzman hekim raporuyla tüm hekimlerce reçete edilir.',
    kaynak: sut('4.2.38', 'Diyabet tedavisinde ilaç kullanım ilkeleri'),
    raporGerekli: true,
    raporTuru: 'uzman',
    raporDuzenleyenBranslar: [...DIYABET_UZMANLARI, 'Aile Hekimliği'],
    raporsuzYazabilenBranslar: [...DIYABET_UZMANLARI, 'Aile Hekimliği'],
  }),

  // 4.2.24.A Astım: lökotrien reseptör antagonistleri
  ...grup('4.2.24.A', ['MONTELUKAST', 'ZAFIRLUKAST'], {
    aciklama:
      'Montelukast ve zafirlukast iç hastalıkları, çocuk sağlığı ve hastalıkları, göğüs hastalıkları ve alerji uzmanlarınca veya bu uzmanlardan birinin düzenlediği uzman hekim raporuyla diğer hekimlerce reçete edilir.',
    kaynak: sut('4.2.24.A', 'Astım tedavisinde ilaç kullanım ilkeleri'),
    raporGerekli: true,
    raporTuru: 'uzman',
    raporDuzenleyenBranslar: ['İç Hastalıkları', 'Çocuk Sağlığı ve Hastalıkları', 'Göğüs Hastalıkları', 'Alerji', 'İmmünoloji ve Alerji'],
    raporsuzYazabilenBranslar: ['İç Hastalıkları', 'Çocuk Sağlığı ve Hastalıkları', 'Göğüs Hastalıkları', 'Alerji', 'İmmünoloji ve Alerji'],
  }),

  // EK-4/F madde 7: demans ilaçları ve riluzol
  ...grup('EK-4-F', ['DONEPEZIL', 'RIVASTIGMIN', 'GALANTAMIN', 'MEMANTIN', 'RILUZOL'], {
    aciklama:
      'Nöroloji, geriatri ve psikiyatri uzmanlarınca raporsuz, bu uzmanların düzenlediği uzman hekim raporuyla tüm hekimlerce reçete edilir. EK-4/F ilaçlarında rapora doz, uygulama planı ve süre yazılır; rapor en fazla 2 yıl geçerlidir ve bir reçeteyle en fazla 3 aylık doz verilir.',
    kaynak: { tur: 'SUT', madde: 'EK-4/F', aciklama: `Ayakta tedavide sağlık raporu ile verilebilecek ilaçlar listesi, madde 7; SUT 4.1.8. ${KAYNAK_NOTU}` },
    raporGerekli: true,
    raporAzamiGun: 731,
    maksTedaviGunu: 90,
    raporDuzenleyenBranslar: ['Nöroloji', 'Geriatri', 'İç Hastalıkları Geriatri', 'Psikiyatri'],
    raporsuzYazabilenBranslar: ['Nöroloji', 'Geriatri', 'İç Hastalıkları Geriatri', 'Psikiyatri'],
    raporIcerigi: ['ilacın kullanım dozu, uygulama planı ve tedavi süresi'],
  }),

  // 4.2.17.A Osteoporoz: bisfosfonatlar
  ...grup('4.2.17', ['ALENDRONAT', 'RISEDRONAT', 'IBANDRONAT', 'ZOLEDRONIK ASIT'], {
    aciklama:
      'Bisfosfonatlar; iç hastalıkları, fiziksel tıp ve rehabilitasyon, ortopedi ve travmatoloji, romatoloji, tıbbi ekoloji ve hidroklimatoloji, kadın hastalıkları ve doğum ya da endokrinoloji uzmanının düzenlediği, tedavi süresinin belirtildiği 2 yıl süreli uzman hekim raporuyla tüm uzman hekimlerce reçete edilir (pratisyen hekim yazamaz). Osteoporoz ilaçlarından birden fazlası birlikte kullanılırsa yalnızca birinin bedeli ödenir.',
    kaynak: sut('4.2.17.A', 'Osteoporoz'),
    raporGerekli: true,
    raporTuru: 'uzman',
    raporAzamiGun: 731,
    raporDuzenleyenBranslar: OSTEOPOROZ_UZMANLARI,
    raporIcerigi: [
      'rapordan önceki son 2 yıl içindeki KMY ölçümünün tarihi ve T değeri (kırık varsa ≤ -1; kırıksız 65 yaş ve üstü ≤ -2,5; 65 yaş altı ≤ -3; sekonder osteoporozda ≤ -1). 75 yaş ve üstü ya da osteoporotik kalça kırığında KMY aranmaz',
      'tedavi süresi',
      'reçeteyi yazan hekimin uzman hekim olduğu',
    ],
  }),

  // 4.2.17.A (6) Osteoporoz: raloksifen, stronsiyum ranelat, denosumab
  ...grup('4.2.17', ['RALOKSIFEN', 'STRONSIYUM RANELAT', 'DENOSUMAB'], {
    aciklama:
      'Bisfosfonatları tolere edemeyen ya da yeterli yanıt alınamayan hastalarda (denosumabda renal yetmezlik nedeniyle kullanamayanlarda da) bu durumun yazıldığı, osteoporoz uzmanlarından en az birinin yer aldığı sağlık kurulu raporuyla tüm uzman hekimlerce reçete edilir. Denosumab, hormon ablasyonu yapılmış prostat kanseri ya da aromataz inhibitörü alan meme kanserinde en az bir tıbbi onkoloji uzmanının yer aldığı kurul raporuyla da verilir. Rapor süresi 2 yıldır.',
    kaynak: sut('4.2.17.A', 'Osteoporoz'),
    raporGerekli: true,
    raporTuru: 'saglik-kurulu',
    raporAzamiGun: 731,
    raporDuzenleyenBranslar: [...OSTEOPOROZ_UZMANLARI.filter((b) => b !== 'Tıbbi Ekoloji ve Hidroklimatoloji'), 'Tıbbi Onkoloji'],
    raporIcerigi: [
      'bisfosfonatların tolere edilemediği ya da yeterli yanıt alınamadığı (denosumabda renal yetmezlik de olabilir) ya da onkoloji endikasyonu',
      'rapordan önceki son 2 yıl içindeki KMY ölçümünün tarihi ve T değeri',
      'reçeteyi yazan hekimin uzman hekim olduğu',
    ],
  }),
];
