// SUT kontrol motorunun veri modeli.
// Tarihler ISO biçiminde (YYYY-AA-GG) tutulur; saat dilimi sorunlarını önlemek için Date nesnesi kullanılmaz.

export type Seviye = 'kirmizi' | 'sari';
export type Durum = 'kirmizi' | 'sari' | 'yesil';

export type ReceteTuru = 'normal' | 'kirmizi' | 'yesil' | 'mor' | 'turuncu';
export type RaporTuru = 'uzman' | 'saglik-kurulu';

/** Bir uyarının dayandığı mevzuat kaynağı. Her uyarı en az bir kaynak taşır. */
export interface Kaynak {
  tur: 'SUT' | 'EK-4/A' | 'Protokol' | 'Mevzuat' | 'Sistem';
  /** Örn. "4.2.15.A" — SUT madde numarası */
  madde?: string;
  aciklama: string;
  resmiGazete?: { tarih: string; sayi?: string };
  url?: string;
}

export interface Hekim {
  ad: string;
  brans: string;
}

export interface RaporIlaci {
  etkenMadde: string;
  /** Rapordaki günlük doz, kalemle aynı birimde */
  gunlukDoz?: number;
  birim?: string;
}

export interface Rapor {
  no: string;
  tur: RaporTuru;
  baslangic: string;
  bitis: string;
  duzenleyenBranslar: string[];
  /** ICD-10 kodları, örn. "I25.1" */
  tanilar: string[];
  ilaclar: RaporIlaci[];
}

export interface ReceteKalemi {
  barkod: string;
  ad: string;
  etkenMadde: string;
  /** Kutu adedi */
  adet: number;
  /** Günlük doz (birim cinsinden) */
  gunlukDoz?: number;
  birim?: string;
  /** Bir kutudaki birim sayısı (tablet, flakon vb.) */
  kutuIcerik?: number;
}

export interface Recete {
  no: string;
  tarih: string;
  tur: ReceteTuru;
  hekim: Hekim;
  tanilar: string[];
  kalemler: ReceteKalemi[];
  raporlar: Rapor[];
  /** Eczacının Medula'ya girdiği uyarı kodları */
  girilenUyariKodlari?: string[];
  /** Reçetenin üzerinde gerçekten bulunan uyarı kodları */
  receteUyariKodlari?: string[];
}

export interface GecmisVerilis {
  etkenMadde: string;
  tarih: string;
  adet: number;
  kutuIcerik?: number;
  gunlukDoz?: number;
}

/** EK-4/A listesindeki bir satır (yalnızca kontrol için gereken alanlar) */
export interface Ek4aKaydi {
  kamuNo?: string;
  barkod: string;
  ad: string;
  esdegerGrubu?: string;
}

export interface Ek4aListesi {
  /** Listenin SGK tarafından yayımlandığı / geçerli olduğu tarih */
  yayimTarihi: string;
  bul(barkod: string): Ek4aKaydi | undefined;
}

/**
 * Bir etken madde için SUT'tan çıkarılmış ödeme koşulları.
 * Her kayıt tek bir kaynağa bağlıdır ve geçerlilik aralığı taşır; SUT değiştiğinde
 * eski kayıt kapatılır, yenisi eklenir. Böylece geçmiş tarihli reçeteler doğru kuralla kontrol edilir.
 */
export interface IlacKurali {
  id: string;
  etkenMadde: string;
  aciklama: string;
  kaynak: Kaynak;
  gecerlilik: { baslangic: string; bitis?: string };
  /** true ise kural doğrulanmamış örnek veridir; arayüzde belirtilir */
  ornek?: boolean;
  raporGerekli?: boolean;
  raporTuru?: RaporTuru;
  raporDuzenleyenBranslar?: string[];
  receteEdenBranslar?: string[];
  /** ICD-10 önekleri; rapordaki tanılardan en az biri bunlardan biriyle başlamalı */
  izinliTanilar?: string[];
  maksGunlukDoz?: number;
  receteTuru?: ReceteTuru;
  /** Bir reçeteyle verilebilecek en uzun tedavi süresi (gün) */
  maksTedaviGunu?: number;
}

export interface MotorAyarlari {
  /** Reçetenin karşılanabileceği en uzun süre (gün). SUT'tan doğrulanarak ayarlanmalı. */
  receteGecerlilikGunu: number;
  /** Önceki verilişin bu oranından fazlası henüz bitmemişse erken tekrar uyarısı verilir (0-1) */
  erkenTekrarEsigi: number;
}

export interface KontrolGirdisi {
  recete: Recete;
  /** Kontrolün yapıldığı gün (karşılama tarihi) */
  bugun: string;
  ek4a: Ek4aListesi;
  ilacKurallari: IlacKurali[];
  gecmis?: GecmisVerilis[];
  ayarlar: MotorAyarlari;
}

export interface Bulgu {
  kuralId: string;
  seviye: Seviye;
  mesaj: string;
  kaynaklar: Kaynak[];
  barkod?: string;
  /** Bulgu örnek (doğrulanmamış) bir kurala dayanıyorsa true */
  ornekKural?: boolean;
}

export interface KontrolSonucu {
  receteNo: string;
  durum: Durum;
  bulgular: Bulgu[];
  kontrolTarihi: string;
  ek4aYayimTarihi: string;
}

/** Sarı bulgular için eczacının yazdığı gerekçeler: kuralId + barkod -> metin */
export type Gerekceler = Record<string, string>;
