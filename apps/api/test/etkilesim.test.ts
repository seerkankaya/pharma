import { describe, expect, it } from 'vitest';
import { ornekIlacKurallari, ornekReceteler, type Recete } from '@scalpiq/sut-motoru';
import { bilesenler, etkilesimKontrol, kuralDogrula, ORNEK_ETKILESIMLER } from '../src/etkilesim/etkilesim.js';
import { girisYap, kur } from './yardimci.js';

describe('etkileşim kontrolü', () => {
  it('reçetedeki iki ilacın etkileşimini bulur; Türkçe harf ve kombinasyon fark etmez', () => {
    expect(bilesenler('Sülfametoksazol + Trimetoprim')).toEqual(['SULFAMETOKSAZOL', 'TRIMETOPRIM']);
    const u = etkilesimKontrol([{ etkenMadde: 'Metotreksat' }, { etkenMadde: 'SÜLFAMETOKSAZOL + TRİMETOPRİM' }, { etkenMadde: 'PARASETAMOL' }], ORNEK_ETKILESIMLER);
    expect(u).toEqual([
      expect.objectContaining({ kuralId: 'ORNEK-METOTREKSAT-TRIMETOPRIM', siddet: 'ciddi', ilaclar: ['Metotreksat', 'SÜLFAMETOKSAZOL + TRİMETOPRİM'], ornekKural: true }),
    ]);
  });

  it('hastanın yakın geçmişteki ilacıyla etkileşimi işaretler, şiddete göre sıralar', () => {
    const u = etkilesimKontrol(
      [{ etkenMadde: 'KLARITROMISIN' }, { etkenMadde: 'IBUPROFEN' }],
      ORNEK_ETKILESIMLER,
      [{ etkenMadde: 'VARFARIN' }, { etkenMadde: 'SIMVASTATIN' }, { etkenMadde: 'ASETILSALISILIK ASIT' }],
    );
    expect(u.map((x) => [x.kuralId, x.ilaclar, x.gecmistenMi])).toEqual([
      ['ORNEK-KLARITROMISIN-STATIN', ['KLARITROMISIN', 'SIMVASTATIN'], true],
      ['ORNEK-VARFARIN-NSAII', ['VARFARIN', 'IBUPROFEN'], true],
    ]);
    expect(etkilesimKontrol([{ etkenMadde: 'PARASETAMOL' }], ORNEK_ETKILESIMLER, [{ etkenMadde: 'VARFARIN' }, { etkenMadde: 'IBUPROFEN' }])).toEqual([]);
  });

  it('kural doğrulama', () => {
    expect(kuralDogrula({ a: ['X'], b: ['x'], siddet: 'orta', mesaj: 'm', kaynak: 'k' })).toEqual(['Aynı etken madde iki tarafta birden olamaz']);
    expect(kuralDogrula({ a: [], b: ['Y'], siddet: 'hafif' as never })).toHaveLength(4);
  });
});

describe('etkileşim API', () => {
  it('kontrol sonucuna klinik uyarı ekler ama gönderimi kilitlemez; eczanenin kuralı yalnız kendisinde geçerli', async () => {
    const { app, kullanicilar } = await kur(ornekIlacKurallari);
    const eczaci = await girisYap(app, kullanicilar.eczaci.eposta);
    const calisan = await girisYap(app, kullanicilar.calisan.eposta);
    const baska = await girisYap(app, kullanicilar.baskaEczane.eposta);
    const recete: Recete = structuredClone(ornekReceteler.find((o) => o.recete.no === 'E-1001')!.recete);
    const etken = recete.kalemler[0]!.etkenMadde;

    const ilk = (await calisan('POST', '/api/kontrol', { recete, gecmis: [{ etkenMadde: 'ÖRNEK-ETKİLEŞEN', tarih: '2026-10-01', adet: 1 }] })).json();
    expect(ilk.klinikUyarilar).toEqual([]);

    const kural = { a: [etken], b: ['ÖRNEK-ETKİLEŞEN'], siddet: 'ciddi', mesaj: 'Test etkileşimi', kaynak: 'Test kaynağı' };
    expect((await calisan('POST', '/api/etkilesimler', kural)).statusCode).toBe(403);
    expect((await eczaci('POST', '/api/etkilesimler', kural)).statusCode).toBe(201);

    const k = (await calisan('POST', '/api/kontrol', { recete: { ...recete, no: 'E-1001-B' }, gecmis: [{ etkenMadde: 'Örnek-Etkileşen', tarih: '2026-10-01', adet: 1 }] })).json();
    expect(k.durum).toBe('yesil');
    expect(k.klinikUyarilar).toEqual([expect.objectContaining({ siddet: 'ciddi', mesaj: 'Test etkileşimi', gecmistenMi: true })]);
    expect((await calisan('POST', '/api/gonder', { kontrolId: k.kontrolId })).statusCode).toBe(200);

    expect((await baska('POST', '/api/etkilesimler/kontrol', { etkenMaddeler: [etken, 'ÖRNEK-ETKİLEŞEN'] })).json()).toEqual([]);
    expect((await calisan('POST', '/api/etkilesimler/kontrol', { etkenMaddeler: ['SILDENAFIL', 'NITROGLISERIN'] })).json()[0].siddet).toBe('kontrendike');
    expect((await calisan('POST', '/api/etkilesimler/kontrol', { etkenMaddeler: ['X'] })).statusCode).toBe(400);
    expect((await calisan('GET', '/api/etkilesimler')).json()).toHaveLength(ORNEK_ETKILESIMLER.length + 1);
  });
});
