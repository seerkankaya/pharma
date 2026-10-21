import { describe, expect, it } from 'vitest';
import { cakisanKural, etkinKurallar, kuralDogrula, ornekIlacKurallari, type IlacKurali } from '../src/index.js';

const temel = (): IlacKurali => ({
  id: 'K1',
  etkenMadde: 'MADDE-X',
  aciklama: 'Açıklama',
  kaynak: { tur: 'SUT', madde: '4.2.1', aciklama: 'SUT', resmiGazete: { tarih: '2026-01-01' } },
  gecerlilik: { baslangic: '2026-01-01' },
});

describe('kural doğrulama', () => {
  it('örnek kurallar geçerlidir', () => {
    for (const k of ornekIlacKurallari) expect(kuralDogrula(k)).toEqual([]);
  });

  it('eksik ve hatalı alanları bildirir', () => {
    const k = { ...temel(), etkenMadde: '', izinliTanilar: ['I25', 'yanlış'], maksTedaviGunu: 1.5, raporTuru: 'uzman' as const };
    k.kaynak = { tur: 'SUT', aciklama: 'SUT' };
    k.gecerlilik = { baslangic: '2026-05-01', bitis: '2026-01-01' };
    expect(kuralDogrula(k)).toEqual([
      'Etken madde boş olamaz',
      'SUT kaynağı için madde numarası gerekli',
      'Geçerlilik bitişi başlangıçtan önce olamaz',
      'Geçersiz ICD-10 kodu: yanlış',
      'Azami tedavi günü pozitif tam sayı olmalı',
      'Rapor türü, rapor branşı, raporsuz yazabilen branş, rapor süresi veya rapor içeriği verildiyse "rapor gerekli" işaretlenmeli',
    ]);
  });

  it('onaysız ve örnek olmayan kuralları kontrol dışında bırakır', () => {
    const onayli = { ...temel(), id: 'A', onay: { onaylayan: 'Ecz. X', tarih: '2026-10-20' } };
    expect(etkinKurallar([temel(), onayli]).map((k) => k.id)).toEqual(['A']);
  });

  it('aynı etken madde için çakışan onaylı kuralı bulur', () => {
    const eski = { ...temel(), id: 'ESKI', onay: { onaylayan: 'Ecz. X', tarih: '2026-01-01' } };
    expect(cakisanKural([eski], { ...temel(), id: 'YENI', gecerlilik: { baslangic: '2026-06-01' } })?.id).toBe('ESKI');
    const kapali = { ...eski, gecerlilik: { baslangic: '2026-01-01', bitis: '2026-05-31' } };
    expect(cakisanKural([kapali], { ...temel(), id: 'YENI', gecerlilik: { baslangic: '2026-06-01' } })).toBeUndefined();
  });
});
