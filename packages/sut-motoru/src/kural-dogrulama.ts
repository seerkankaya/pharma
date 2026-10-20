import { gunFarki } from './tarih.js';
import type { IlacKurali } from './types.js';

const ISO_TARIH = /^\d{4}-\d{2}-\d{2}$/;
const ICD10_ONEK = /^[A-Z]\d{2}(\.\d{1,2})?$/;

function tarihGecerli(t: string | undefined): boolean {
  return !!t && ISO_TARIH.test(t) && !Number.isNaN(Date.parse(`${t}T00:00:00Z`));
}

/** Kuralın kaydedilebilir olup olmadığını denetler; hataları Türkçe döndürür. */
export function kuralDogrula(k: IlacKurali): string[] {
  const hatalar: string[] = [];
  if (!k.id?.trim()) hatalar.push('Kural kimliği boş olamaz');
  if (!k.etkenMadde?.trim()) hatalar.push('Etken madde boş olamaz');
  if (!k.aciklama?.trim()) hatalar.push('Açıklama boş olamaz');
  if (!k.kaynak?.aciklama?.trim()) hatalar.push('Kaynak açıklaması boş olamaz');
  if (k.kaynak?.tur === 'SUT' && !k.kaynak.madde?.trim()) hatalar.push('SUT kaynağı için madde numarası gerekli');
  if (k.kaynak?.resmiGazete && !tarihGecerli(k.kaynak.resmiGazete.tarih)) hatalar.push('Resmî Gazete tarihi YYYY-AA-GG olmalı');

  if (!tarihGecerli(k.gecerlilik?.baslangic)) hatalar.push('Geçerlilik başlangıcı YYYY-AA-GG olmalı');
  if (k.gecerlilik?.bitis !== undefined) {
    if (!tarihGecerli(k.gecerlilik.bitis)) hatalar.push('Geçerlilik bitişi YYYY-AA-GG olmalı');
    else if (tarihGecerli(k.gecerlilik.baslangic) && gunFarki(k.gecerlilik.baslangic, k.gecerlilik.bitis) < 0)
      hatalar.push('Geçerlilik bitişi başlangıçtan önce olamaz');
  }

  for (const t of k.izinliTanilar ?? []) if (!ICD10_ONEK.test(t)) hatalar.push(`Geçersiz ICD-10 kodu: ${t}`);
  if (k.maksGunlukDoz !== undefined && !(k.maksGunlukDoz > 0)) hatalar.push('Azami günlük doz pozitif olmalı');
  if (k.maksTedaviGunu !== undefined && !(Number.isInteger(k.maksTedaviGunu) && k.maksTedaviGunu > 0))
    hatalar.push('Azami tedavi günü pozitif tam sayı olmalı');
  if (!k.raporGerekli && (k.raporTuru || k.raporDuzenleyenBranslar?.length))
    hatalar.push('Rapor türü veya rapor branşı verildiyse "rapor gerekli" işaretlenmeli');
  return hatalar;
}

/** Kontrolde kullanılacak kurallar: onaylı olanlar ve açıkça örnek olarak işaretlenenler. */
export function etkinKurallar(kurallar: IlacKurali[]): IlacKurali[] {
  return kurallar.filter((k) => k.onay || k.ornek);
}

/**
 * Aynı etken madde için geçerlilik aralıkları çakışan onaylı kuralları bulur.
 * Çakışma varsa motor hangi kuralı kullanacağını bilemez; yeni kural eklenmeden önce eskisi kapatılmalıdır.
 */
export function cakisanKural(kurallar: IlacKurali[], yeni: IlacKurali): IlacKurali | undefined {
  const bitis = (k: IlacKurali) => k.gecerlilik.bitis ?? '9999-12-31';
  return etkinKurallar(kurallar).find(
    (k) =>
      k.id !== yeni.id &&
      k.etkenMadde.trim().toLocaleUpperCase('tr-TR') === yeni.etkenMadde.trim().toLocaleUpperCase('tr-TR') &&
      gunFarki(k.gecerlilik.baslangic, bitis(yeni)) >= 0 &&
      gunFarki(yeni.gecerlilik.baslangic, bitis(k)) >= 0,
  );
}
