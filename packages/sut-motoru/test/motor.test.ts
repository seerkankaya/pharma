import { describe, expect, it } from 'vitest';
import {
  gerekceAnahtari,
  gonderimeIzinVarMi,
  kontrolEt,
  ornekEk4a,
  ornekGecmis,
  ornekIlacKurallari,
  ornekReceteler,
  varsayilanAyarlar,
  type GecmisVerilis,
  type IlacKurali,
  type Recete,
} from '../src/index.js';

function recete(no: string): Recete {
  const r = ornekReceteler.find((o) => o.recete.no === no);
  if (!r) throw new Error(no);
  return structuredClone(r.recete);
}

function kontrol(r: Recete, gecmis: GecmisVerilis[] = [], kurallar: IlacKurali[] = ornekIlacKurallari) {
  return kontrolEt({ recete: r, bugun: '2026-10-20', ek4a: ornekEk4a, ilacKurallari: kurallar, gecmis, ayarlar: varsayilanAyarlar });
}

const kurallar = (s: ReturnType<typeof kontrol>) => s.bulgular.map((b) => b.kuralId).sort();

describe('SUT kontrol motoru', () => {
  it('uygun reçeteyi yeşil işaretler', () => {
    const s = kontrol(recete('E-1001'));
    expect(s.durum).toBe('yesil');
    expect(s.bulgular).toEqual([]);
    expect(gonderimeIzinVarMi(s).izin).toBe(true);
  });

  it('süresi dolmuş raporu ve doz aşımını yakalar', () => {
    const s = kontrol(recete('E-1002'));
    expect(s.durum).toBe('kirmizi');
    expect(kurallar(s)).toEqual(['DOZ', 'DOZ', 'RAPOR_SURESI']);
  });

  it('rapor türünü, rapor branşını ve reçete eden branşı denetler', () => {
    const s = kontrol(recete('E-1003'));
    expect(kurallar(s)).toEqual(['RAPOR_BRANS', 'RAPOR_TURU', 'RECETE_EDEN_BRANS']);
  });

  it('erken tekrar ve tanımsız ilaç için sarı uyarı verir', () => {
    const s = kontrol(recete('E-1004'), [...ornekGecmis['E-1004']]);
    expect(s.durum).toBe('sari');
    expect(kurallar(s)).toEqual(['ERKEN_TEKRAR', 'KURAL_TANIMSIZ']);
  });

  it('listede olmayan barkodu, reçete türünü ve uyarı kodunu yakalar', () => {
    const s = kontrol(recete('E-1005'));
    expect(kurallar(s)).toEqual(['EK4A_LISTE', 'RECETE_TURU', 'UYARI_KODU']);
  });

  it('eski barkodu EK-4/A kaydına eşler', () => {
    const r = recete('E-1001');
    r.kalemler[0]!.barkod = '8690000000004';
    expect(kontrol(r).durum).toBe('yesil');
  });

  it('rapor gerekli ilaçta rapor yoksa kırmızı verir', () => {
    const r = recete('E-1001');
    r.raporlar = [];
    expect(kurallar(kontrol(r))).toContain('RAPOR_GEREKLI');
  });

  it('rapordaki tanı uyumsuzsa kırmızı verir', () => {
    const r = recete('E-1001');
    r.raporlar[0]!.tanilar = ['E11.9'];
    expect(kurallar(kontrol(r))).toEqual(['TANI_UYUMU']);
  });

  it('tedavi süresini aşan miktara sarı uyarı verir', () => {
    const r = recete('E-1001');
    r.kalemler[0]!.adet = 4;
    expect(kurallar(kontrol(r))).toEqual(['TEDAVI_SURESI']);
  });

  it('süresi geçmiş reçeteyi yakalar', () => {
    const r = recete('E-1001');
    r.tarih = '2026-10-10';
    r.raporlar[0]!.baslangic = '2026-01-01';
    expect(kurallar(kontrol(r))).toEqual(['RECETE_GECERLILIK']);
  });

  it('reçete tarihinde geçerli kural sürümünü kullanır', () => {
    const eski: IlacKurali = { ...ornekIlacKurallari[0]!, id: 'ESKI', gecerlilik: { baslangic: '2025-01-01', bitis: '2025-12-31' }, maksGunlukDoz: 3 };
    const yeni: IlacKurali = { ...ornekIlacKurallari[0]!, id: 'YENI', gecerlilik: { baslangic: '2026-01-01' }, maksGunlukDoz: 1 };
    const r = recete('E-1001');
    r.kalemler[0]!.gunlukDoz = 2;
    r.raporlar[0]!.ilaclar[0]!.gunlukDoz = 2;
    const bulgu = kontrol(r, [], [eski, yeni]).bulgular.find((b) => b.kuralId === 'DOZ');
    expect(bulgu?.mesaj).toContain('üst sınırı (1)');
  });

  it('her bulgu en az bir kaynak taşır', () => {
    for (const o of ornekReceteler) {
      for (const b of kontrol(structuredClone(o.recete)).bulgular) expect(b.kaynaklar.length).toBeGreaterThan(0);
    }
  });
});

describe('gönderim kilidi', () => {
  it('kırmızı bulgu varken gerekçe olsa da gönderime izin vermez', () => {
    const s = kontrol(recete('E-1002'));
    const gerekceler = Object.fromEntries(s.bulgular.map((b) => [gerekceAnahtari(b), 'Hekimle görüşüldü, düzeltildi.']));
    expect(gonderimeIzinVarMi(s, gerekceler).izin).toBe(false);
  });

  it('sarı bulgular gerekçe yazılınca gönderime izin verir', () => {
    const s = kontrol(recete('E-1004'), [...ornekGecmis['E-1004']]);
    expect(gonderimeIzinVarMi(s).izin).toBe(false);
    expect(gonderimeIzinVarMi(s, { [gerekceAnahtari(s.bulgular[0]!)]: 'kısa' }).izin).toBe(false);
    const gerekceler = Object.fromEntries(s.bulgular.map((b) => [gerekceAnahtari(b), 'Hasta ilacını kaybetti, tutanak alındı.']));
    expect(gonderimeIzinVarMi(s, gerekceler).izin).toBe(true);
  });
});
