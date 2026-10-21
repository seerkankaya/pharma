import { describe, expect, it } from 'vitest';
import { adindakiMg, etkinKurallar, haritaListesi, kontrolEt, kuralDogrula, ornekEk4a, sutTaslakKurallari, varsayilanAyarlar, type IlacKurali, type Recete } from '../src/index.js';

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

/** Kalemin adı da verilebilir; yüksek doz kontrolü dozu addan okur. */
function receteAdli(ad: string, etkenMadde: string, brans: string, raporlar: Recete['raporlar'] = []): Recete {
  const r = recete(etkenMadde, brans, raporlar);
  return { ...r, kalemler: [{ ...r.kalemler[0]!, ad }] };
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

  it('yeni oral antikoagülan: 1 yıllık rapor, yetkili branş ve yetkili hekim ister', () => {
    const k = kural('SUT-4.2.15.D-APIKSABAN');
    const kurul = rapor('APIKSABAN', { tur: 'saglik-kurulu', duzenleyenBranslar: ['Kardiyoloji', 'İç Hastalıkları', 'Nöroloji'] });
    expect(bulgular(recete('APIKSABAN', 'Kardiyoloji', [kurul]), k)).toEqual(['RAPOR_ICERIGI']);
    // 24 aydan sonra devam raporuyla aile hekimi de yazabilir; bu yüzden aile hekimi ve uzman raporu kesinti değil, kontrol maddesi.
    expect(bulgular(recete('APIKSABAN', 'Aile Hekimliği', [{ ...kurul, tur: 'uzman' }]), k)).toEqual(['RAPOR_ICERIGI']);
    expect(bulgular(recete('APIKSABAN', 'Ortopedi ve Travmatoloji', [kurul]), k)).toEqual(['RAPOR_ICERIGI', 'RECETE_EDEN_BRANS']);
    expect(bulgular(recete('APIKSABAN', 'Kardiyoloji', [{ ...kurul, baslangic: '2026-01-01', bitis: '2027-12-31' }]), k)).toEqual([
      'RAPOR_AZAMI_SURE',
      'RAPOR_ICERIGI',
    ]);
  });

  it('yüksek doz statinin raporunu yalnızca yetkili branş düzenler', () => {
    const k = kural('SUT-4.2.28-ATORVASTATIN');
    const ortopedi = rapor('ATORVASTATIN', { duzenleyenBranslar: ['Ortopedi ve Travmatoloji'] });
    expect(bulgular(receteAdli('LIPITOR 20 MG 30 FILM TABLET', 'ATORVASTATIN', 'Aile Hekimliği', [ortopedi]), k)).toEqual(['RAPOR_ICERIGI']);
    expect(bulgular(receteAdli('LIPITOR 40 MG 30 FILM TABLET', 'ATORVASTATIN', 'Aile Hekimliği', [ortopedi]), k)).toEqual([
      'RAPOR_ICERIGI',
      'YUKSEK_DOZ_BRANS',
    ]);
    const kardiyoloji = rapor('ATORVASTATIN', { duzenleyenBranslar: ['Kardiyoloji'] });
    expect(bulgular(receteAdli('LIPITOR 80 MG 30 FILM TABLET', 'ATORVASTATIN', 'Aile Hekimliği', [kardiyoloji]), k)).toEqual(['RAPOR_ICERIGI']);
    // Kombine üründe hangi dozun statine ait olduğu addan anlaşılmaz: eczacıya sorulur.
    const r = kontrolEt({
      recete: receteAdli('CADUET 10/40 MG 30 TABLET', 'ATORVASTATIN', 'Aile Hekimliği', [ortopedi]),
      bugun: '2026-10-20',
      ek4a: ornekEk4a,
      ilacKurallari: [{ ...k, onay: { onaylayan: 'Test', tarih: '2026-10-01' } }],
      ayarlar: varsayilanAyarlar,
    });
    expect(r.bulgular.find((b) => b.kuralId === 'YUKSEK_DOZ_BRANS')?.seviye).toBe('sari');
    // Aile hekimliği uzmanı ancak devam raporu düzenleyebilir.
    const aile = rapor('ATORVASTATIN', { duzenleyenBranslar: ['Aile Hekimliği'] });
    const d = kontrolEt({
      recete: receteAdli('LIPITOR 40 MG 30 FILM TABLET', 'ATORVASTATIN', 'Aile Hekimliği', [aile]),
      bugun: '2026-10-20',
      ek4a: ornekEk4a,
      ilacKurallari: [{ ...k, onay: { onaylayan: 'Test', tarih: '2026-10-01' } }],
      ayarlar: varsayilanAyarlar,
    });
    expect(d.bulgular.find((b) => b.kuralId === 'YUKSEK_DOZ_BRANS')?.seviye).toBe('sari');
  });

  it('raporsuz yazılan klopidogrelde raporsuz yazılma koşulu hatırlatılır', () => {
    const k = kural('SUT-4.2.15-KLOPIDOGREL');
    expect(bulgular(recete('KLOPIDOGREL', 'Kardiyoloji'), k)).toEqual(['RAPORSUZ_KOSUL']);
    expect(bulgular(recete('KLOPIDOGREL', 'Aile Hekimliği'), k)).toEqual(['RAPOR_GEREKLI']);
    expect(bulgular(recete('KLOPIDOGREL', 'Aile Hekimliği', [rapor('KLOPIDOGREL', { duzenleyenBranslar: ['Nöroloji'] })]), k)).toEqual([
      'RAPOR_ICERIGI',
    ]);
  });

  it('osteoporozda raloksifen sağlık kurulu raporu ister', () => {
    const k = kural('SUT-4.2.17-RALOKSIFEN');
    const r = rapor('RALOKSIFEN', { duzenleyenBranslar: ['Kadın Hastalıkları ve Doğum'], baslangic: '2026-01-01', bitis: '2027-12-31' });
    expect(bulgular(recete('RALOKSIFEN', 'Kadın Hastalıkları ve Doğum', [r]), k)).toEqual(['RAPOR_ICERIGI', 'RAPOR_TURU']);
    expect(bulgular(recete('RALOKSIFEN', 'Kadın Hastalıkları ve Doğum', [{ ...r, tur: 'saglik-kurulu' }]), k)).toEqual(['RAPOR_ICERIGI']);
  });
});

describe('EK-4/A pasif dönemleri', () => {
  const liste = haritaListesi('2026-10-02', [
    { barkod: '8690000000099', ad: 'PASIF ILAC', pasifAraliklari: [{ baslangic: '2026-03-02', bitis: '2026-07-06' }, { baslangic: '2026-10-01' }] },
  ]);
  const kontrol = (tarih: string) =>
    kontrolEt({
      recete: { ...recete('X', 'Aile Hekimliği'), tarih, kalemler: [{ barkod: '8690000000099', ad: 'PASIF ILAC', etkenMadde: 'X', adet: 1 }] },
      bugun: tarih,
      ek4a: liste,
      ilacKurallari: [],
      ayarlar: varsayilanAyarlar,
    }).bulgular.filter((b) => b.kuralId === 'EK4A_LISTE');

  it('reçete tarihi pasif döneme düşerse kesinti, aktif döneme düşerse sorun yok', () => {
    expect(kontrol('2026-05-01')).toHaveLength(1);
    expect(kontrol('2026-08-01')).toEqual([]);
    expect(kontrol('2026-10-20')[0]?.mesaj).toContain('2026-10-01 tarihinden beri pasif');
  });
});

describe('ilaç adındaki doz', () => {
  it('tek dozu okur, birden fazla doz varsa belirsiz der', () => {
    expect(adindakiMg('LIPITOR 40 MG 30 FILM TABLET')).toBe(40);
    expect(adindakiMg('CRESTOR 2,5 MG 28 TABLET')).toBe(2.5);
    expect(adindakiMg('ATOR 10MG')).toBe(10);
    expect(adindakiMg('CADUET 10/40 MG')).toBe('belirsiz');
    expect(adindakiMg('INEGY 10 MG/20 MG TABLET')).toBe('belirsiz');
    expect(adindakiMg('XARELTO 2.5 MG 56 TB')).toBe(2.5);
    expect(adindakiMg('INSULIN KALEM 100 IU/ML')).toBeUndefined();
  });
});
