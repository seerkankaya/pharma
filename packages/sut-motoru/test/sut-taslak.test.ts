import { describe, expect, it } from 'vitest';
import { etkinKurallar, kontrolEt, kuralDogrula, ornekEk4a, sutTaslakKurallari, varsayilanAyarlar, type IlacKurali, type Recete } from '../src/index.js';

const kural = (id: string) => sutTaslakKurallari.find((k) => k.id === id)!;

function recete(etkenMadde: string, brans: string, raporlar: Recete['raporlar'] = []): Recete {
  return {
    no: 'T-1',
    tarih: '2026-10-20',
    tur: 'normal',
    hekim: { ad: 'Dr. Test', brans },
    tanilar: ['E11'],
    // Örnek EK-4/A'daki bir barkod; burada yalnızca kural davranışı denetlenir.
    kalemler: [{ barkod: '8690000000011', ad: 'İLAÇ', etkenMadde, adet: 1 }],
    raporlar,
  };
}

const rapor = (etkenMadde: string, ek: Partial<Recete['raporlar'][number]> = {}): Recete['raporlar'][number] => ({
  no: 'R-1',
  tur: 'uzman',
  baslangic: '2026-06-01',
  bitis: '2027-05-31',
  duzenleyenBranslar: ['İç Hastalıkları'],
  tanilar: ['E11'],
  ilaclar: [{ etkenMadde }],
  ...ek,
});

function bulgular(r: Recete, k: IlacKurali) {
  const onayli = { ...k, onay: { onaylayan: 'Test', tarih: '2026-10-01' } };
  return kontrolEt({ recete: r, bugun: '2026-10-20', ek4a: ornekEk4a, ilacKurallari: [onayli], ayarlar: varsayilanAyarlar })
    .bulgular.map((b) => b.kuralId)
    .sort();
}

describe('SUT taslak kuralları', () => {
  it('hepsi geçerli, kimlikleri tekil ve hiçbiri onaylı ya da örnek değil', () => {
    for (const k of sutTaslakKurallari) expect(kuralDogrula(k), k.id).toEqual([]);
    expect(new Set(sutTaslakKurallari.map((k) => k.id)).size).toBe(sutTaslakKurallari.length);
    // Taslak kontrolde kullanılmaz; eczacı onaylayınca devreye girer.
    expect(etkinKurallar(sutTaslakKurallari)).toEqual([]);
  });

  it('uzman raporsuz yazabilir; diğer hekim rapor ister', () => {
    const k = kural('SUT-4.2.38-SITAGLIPTIN');
    expect(bulgular(recete('SITAGLIPTIN', 'Endokrinoloji ve Metabolizma Hastalıkları'), k)).toEqual([]);
    expect(bulgular(recete('SITAGLIPTIN', 'Aile Hekimliği'), k)).toEqual(['RAPOR_GEREKLI']);
    // Raporla aile hekimi yazabilir; raporda olması gerekenler eczacıya hatırlatılır.
    expect(bulgular(recete('SITAGLIPTIN', 'Aile Hekimliği', [rapor('SITAGLIPTIN')]), k)).toEqual(['RAPOR_ICERIGI']);
    // Raporu yetkisiz branş düzenlemişse kesinti.
    expect(bulgular(recete('SITAGLIPTIN', 'Aile Hekimliği', [rapor('SITAGLIPTIN', { duzenleyenBranslar: ['Ortopedi'] })]), k)).toEqual([
      'RAPOR_BRANS',
      'RAPOR_ICERIGI',
    ]);
  });

  it('Medula etken maddeyi tuzuyla ve Türkçe harfle yazsa da kural bulunur', () => {
    const k = kural('SUT-4.2.28-ATORVASTATIN');
    expect(bulgular(recete('ATORVASTATİN KALSİYUM', 'Aile Hekimliği'), k)).toEqual(['RAPOR_GEREKLI']);
    expect(bulgular(recete('ATORVASTATİN KALSİYUM', 'Aile Hekimliği', [rapor('ATORVASTATIN')]), k)).toEqual(['RAPOR_ICERIGI']);
  });

  it('rapor süresi azami süreyi aşarsa kesinti', () => {
    const k = kural('SUT-4.2.17-ALENDRONAT');
    const uzun = rapor('ALENDRONAT', { baslangic: '2025-01-01', bitis: '2027-12-31' });
    expect(bulgular(recete('ALENDRONAT', 'Aile Hekimliği', [uzun]), k)).toEqual(['RAPOR_AZAMI_SURE', 'RAPOR_ICERIGI']);
    const ikiYil = rapor('ALENDRONAT', { baslangic: '2025-06-01', bitis: '2027-05-31' });
    expect(bulgular(recete('ALENDRONAT', 'Aile Hekimliği', [ikiYil]), k)).toEqual(['RAPOR_ICERIGI']);
  });

  it('yeni oral antikoagülan sağlık kurulu raporu ve yetkili hekim ister', () => {
    const k = kural('SUT-4.2.15.D-APIKSABAN');
    const kurul = rapor('APIKSABAN', { tur: 'saglik-kurulu', duzenleyenBranslar: ['Kardiyoloji', 'İç Hastalıkları', 'Nöroloji'] });
    expect(bulgular(recete('APIKSABAN', 'Kardiyoloji', [kurul]), k)).toEqual(['RAPOR_ICERIGI']);
    expect(bulgular(recete('APIKSABAN', 'Aile Hekimliği', [kurul]), k)).toEqual(['RAPOR_ICERIGI', 'RECETE_EDEN_BRANS']);
    expect(bulgular(recete('APIKSABAN', 'Kardiyoloji', [{ ...kurul, tur: 'uzman' }]), k)).toEqual(['RAPOR_ICERIGI', 'RAPOR_TURU']);
  });
});
