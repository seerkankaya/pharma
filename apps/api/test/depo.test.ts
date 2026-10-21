import { describe, expect, it } from 'vitest';
import { efaturaOku, EfaturaHatasi } from '../src/depo/efatura.js';
import { depoCarisi, partiMaliyeti, type DepoIadesi, type DepoOdemesi } from '../src/depo/depo.js';
import type { AlisFaturasi } from '../src/alis/alis.js';
import type { StokHareketi } from '../src/stok/stok.js';
import { girisYap, kur } from './yardimci.js';

const KREM = '8690000000001';
const SAMPUAN = '8690000000002';

/** UBL-TR 1.2 biçiminde kısaltılmış bir e-Fatura. */
function efatura(satirlar: string, ek = '') {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
  xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:UBLVersionID>2.1</cbc:UBLVersionID>
  <cbc:CustomizationID>TR1.2</cbc:CustomizationID>
  <cbc:ProfileID>TICARIFATURA</cbc:ProfileID>
  <cbc:ID>ABC2026000123</cbc:ID>
  <cbc:UUID>f47ac10b-58cc-4372-a567-0e02b2c3d479</cbc:UUID>
  <cbc:IssueDate>2026-10-19</cbc:IssueDate>
  <cbc:InvoiceTypeCode>SATIS</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>TRY</cbc:DocumentCurrencyCode>
  ${ek}
  <cac:AccountingSupplierParty><cac:Party>
    <cac:PartyIdentification><cbc:ID schemeID="MERSISNO">0123456789000015</cbc:ID></cac:PartyIdentification>
    <cac:PartyIdentification><cbc:ID schemeID="VKN">1234567890</cbc:ID></cac:PartyIdentification>
    <cac:PartyName><cbc:Name>Örnek Ecza Deposu A.Ş.</cbc:Name></cac:PartyName>
  </cac:Party></cac:AccountingSupplierParty>
  ${satirlar}
  <cac:LegalMonetaryTotal><cbc:PayableAmount currencyID="TRY">1938.00</cbc:PayableAmount></cac:LegalMonetaryTotal>
</Invoice>`;
}

const satir = (o: { barkod?: string; ad: string; miktar: string; fiyat: string; net: string; kdv?: string; lot?: string; skt?: string }) => `
  <cac:InvoiceLine>
    <cbc:ID>1</cbc:ID>
    <cbc:InvoicedQuantity unitCode="C62">${o.miktar}</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="TRY">${o.net}</cbc:LineExtensionAmount>
    <cac:TaxTotal><cac:TaxSubtotal>
      <cbc:Percent>${o.kdv ?? '10'}</cbc:Percent>
      <cac:TaxCategory><cac:TaxScheme><cbc:Name>KDV</cbc:Name><cbc:TaxTypeCode>0015</cbc:TaxTypeCode></cac:TaxScheme></cac:TaxCategory>
    </cac:TaxSubtotal></cac:TaxTotal>
    <cac:Item>
      <cbc:Name>${o.ad}</cbc:Name>
      ${o.barkod ? `<cac:SellersItemIdentification><cbc:ID>${o.barkod}</cbc:ID></cac:SellersItemIdentification>` : ''}
      ${o.lot ? `<cac:ItemInstance><cac:LotIdentification><cbc:LotNumberID>${o.lot}</cbc:LotNumberID><cbc:ExpiryDate>${o.skt}</cbc:ExpiryDate></cac:LotIdentification></cac:ItemInstance>` : ''}
    </cac:Item>
    <cac:Price><cbc:PriceAmount currencyID="TRY">${o.fiyat}</cbc:PriceAmount></cac:Price>
  </cac:InvoiceLine>`;

describe('e-Fatura okuma', () => {
  it('UBL-TR faturayı alış taslağına çevirir: iskonto, mal fazlası, parti ve SKT', () => {
    const t = efaturaOku(
      efatura(
        satir({ barkod: KREM, ad: 'Krem', miktar: '10', fiyat: '150.00', net: '1425.00', lot: 'P1', skt: '2027-06-30' }) +
          satir({ barkod: KREM, ad: 'Krem MF', miktar: '1', fiyat: '0', net: '0' }) +
          satir({ barkod: `0${SAMPUAN}`, ad: 'Şampuan', miktar: '6', fiyat: '80', net: '480', kdv: '20' }) +
          satir({ ad: 'Kargo bedeli', miktar: '1', fiyat: '33', net: '33' }),
      ),
    );
    expect(t).toMatchObject({
      ettn: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
      faturaNo: 'ABC2026000123',
      tarih: '2026-10-19',
      satici: { ad: 'Örnek Ecza Deposu A.Ş.', vergiNo: '1234567890' },
      odenecekKurus: 193800,
    });
    expect(t.kalemler).toEqual([
      { barkod: KREM, ad: 'Krem', miktar: 10, malFazlasi: 1, birimFiyatKurus: 15000, kdvOrani: 10, iskontoYuzde: 5, partiNo: 'P1', skt: '2027-06-30' },
      { barkod: SAMPUAN, ad: 'Şampuan', miktar: 6, birimFiyatKurus: 8000, kdvOrani: 20, partiNo: '', skt: '' },
    ]);
    expect(t.uyarilar).toEqual([
      '3. satır (Şampuan): faturada parti no ya da son kullanma tarihi yok, elle girin',
      '4. satır (Kargo bedeli): barkod bulunamadı, satır aktarılmadı',
    ]);
  });

  it('iade faturasını, yabancı parayı ve bozuk dosyayı reddeder; varlık genişletmez', () => {
    expect(() => efaturaOku(efatura('').replace('SATIS', 'IADE'))).toThrow('iade faturası');
    expect(() => efaturaOku(efatura('').replace('>TRY<', '>USD<'))).toThrow('USD');
    expect(() => efaturaOku('<html></html>')).toThrow(EfaturaHatasi);
    const bomba = `<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;">]>` + efatura('').split('?>')[1]!.replace('ABC2026000123', '&b;');
    expect(efaturaOku(bomba).faturaNo).toBe('&b;');
  });
});

describe('depo carisi hesabı', () => {
  it('fatura borç, iade ve ödeme alacak yazar; tarih sırasıyla bakiye yürütür', () => {
    const f = { tedarikciId: 'D', faturaNo: 'F1', tarih: '2026-10-01', toplamKurus: 100000, zaman: '2026-10-01T10:00:00Z' } as AlisFaturasi;
    const i = { tedarikciId: 'D', belgeNo: 'I1', tarih: '2026-10-05', neden: 'Miat', toplamKurus: 20000, zaman: '2026-10-05T10:00:00Z' } as DepoIadesi;
    const o = { tedarikciId: 'D', tutarKurus: 50000, odemeTuru: 'havale', tarih: '2026-10-03', zaman: '2026-10-03T10:00:00Z' } as DepoOdemesi;
    const baska = { ...f, tedarikciId: 'E' };
    expect(depoCarisi('D', [f, baska], [i], [o]).map((h) => [h.tur, h.bakiyeKurus])).toEqual([
      ['fatura', 100000],
      ['odeme', 50000],
      ['iade', 30000],
    ]);
  });

  it('partinin maliyeti son girişten gelir', () => {
    const g = (zaman: string, birimMaliyetKurus: number, partiNo = 'P1') => ({ barkod: KREM, partiNo, zaman, birimMaliyetKurus }) as StokHareketi;
    expect(partiMaliyeti([g('2026-10-01', 100), g('2026-10-02', 120), g('2026-10-03', 90, 'P2')], KREM, 'P1')).toBe(120);
    expect(partiMaliyeti([], KREM, 'P1')).toBeUndefined();
  });
});

async function ortam() {
  const o = await kur();
  const eczaci = await girisYap(o.app, o.kullanicilar.eczaci.eposta);
  const calisan = await girisYap(o.app, o.kullanicilar.calisan.eposta);
  await eczaci('PUT', `/api/urunler/${KREM}`, { ad: 'Nemlendirici Krem', kdvOrani: 20, satisFiyatiKurus: 25000 });
  const depo = (await eczaci('POST', '/api/tedarikciler', { ad: 'Örnek Ecza Deposu', vergiNo: '1234567890' })).json();
  const r = await eczaci('POST', '/api/alis-faturalari', {
    tedarikciId: depo.id,
    faturaNo: 'ABC2026000001',
    tarih: '2026-10-19',
    kalemler: [{ barkod: KREM, miktar: 10, partiNo: 'P1', skt: '2027-06-30', birimFiyatKurus: 15000, kdvOrani: 20 }],
  });
  expect(r.statusCode).toBe(201);
  return { ...o, eczaci, calisan, depo };
}

describe('depo API', () => {
  it('e-Fatura taslağı: tedarikçiyi vergi numarasından bulur, girilmiş faturayı ve eksik kartları uyarır', async () => {
    const { eczaci, depo } = await ortam();
    const xml = efatura(
      satir({ barkod: KREM, ad: 'Krem', miktar: '2', fiyat: '150', net: '300', lot: 'P9', skt: '2027-12-31' }) +
        satir({ barkod: SAMPUAN, ad: 'Şampuan', miktar: '6', fiyat: '80', net: '480', lot: 'S1', skt: '2028-01-31' }),
    ).replace('ABC2026000123', 'ABC2026000001');
    const r = (await eczaci('POST', '/api/alis-faturalari/xml', { xml })).json();
    expect(r.tedarikci.id).toBe(depo.id);
    expect(r.taslak).toMatchObject({ tedarikciId: depo.id, faturaNo: 'ABC2026000001', tarih: '2026-10-19' });
    expect(r.uyarilar).toEqual(['ABC2026000001 numaralı fatura bu depodan zaten girilmiş', 'Şampuan: ürün kartı yok, satış fiyatını girin']);

    const yeni = (await eczaci('POST', '/api/alis-faturalari/xml', { xml: xml.replace('>1234567890<', '>9999999999<') })).json();
    expect(yeni.tedarikciOnerisi).toEqual({ ad: 'Örnek Ecza Deposu A.Ş.', vergiNo: '9999999999' });
    expect((await eczaci('POST', '/api/alis-faturalari/xml', { xml: 'x' })).statusCode).toBe(400);
  });

  it('depoya iade: stoktan düşer, maliyeti partiden alır, cariye alacak yazar; aynı belge iki kez girilemez', async () => {
    const { eczaci, calisan, depo } = await ortam();
    const iade = { tedarikciId: depo.id, belgeNo: 'IAD-1', tarih: '2026-10-20', neden: 'Hasarlı ambalaj', kalemler: [{ barkod: KREM, partiNo: 'P1', miktar: 3 }] };
    expect((await calisan('POST', '/api/depo-iadeleri', iade)).statusCode).toBe(403);
    expect((await eczaci('POST', '/api/depo-iadeleri', { ...iade, kalemler: [{ barkod: KREM, partiNo: 'P1', miktar: 11 }] })).json().hata).toContain(
      'P1 partisinde 10 adet var',
    );
    const r = await eczaci('POST', '/api/depo-iadeleri', iade);
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ netKurus: 45000, kdvKurus: 9000, toplamKurus: 54000, kalemler: [{ birimFiyatKurus: 15000, skt: '2027-06-30' }] });
    expect((await eczaci('POST', '/api/depo-iadeleri', iade)).statusCode).toBe(409);
    const [satir] = (await eczaci('GET', '/api/stok')).json();
    expect(satir.miktar).toBe(7);
    expect((await eczaci('GET', '/api/depo-iadeleri')).json()).toHaveLength(1);

    const ode = await eczaci('POST', `/api/depo-carisi/${depo.id}/odeme`, { tutarKurus: 100000, odemeTuru: 'havale', tarih: '2026-10-20', aciklama: 'Ekim' });
    expect(ode.statusCode).toBe(201);
    expect((await eczaci('POST', `/api/depo-carisi/${depo.id}/odeme`, { tutarKurus: 0, odemeTuru: 'altin', tarih: '2027-01-01' })).json().hatalar).toHaveLength(3);
    const cari = (await eczaci('GET', `/api/depo-carisi/${depo.id}`)).json();
    // Fatura: 10 × 150 TL + %20 KDV = 1.800 TL; iade 540 TL; ödeme 1.000 TL
    expect(cari.hareketler.map((h: { tur: string }) => h.tur)).toEqual(['fatura', 'iade', 'odeme']);
    expect(cari.bakiyeKurus).toBe(180000 - 54000 - 100000);
    expect((await eczaci('GET', '/api/depo-carisi')).json()).toEqual([
      { tedarikci: depo, borcKurus: 180000, alacakKurus: 154000, bakiyeKurus: 26000 },
    ]);
  });
});
