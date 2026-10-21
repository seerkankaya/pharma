import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { girisYap, kur, PAROLA } from './yardimci.js';

const BASLIK = ['Kamu No', 'Güncel Barkod', 'Ürün Adı', 'Eski Barkod-1', 'Eski Barkod-2', 'Eşdeğer (Benzer) Ürün Grubu'];

function dosya(satirlar: unknown[][]): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['BEDELİ ÖDENECEK İLAÇLAR LİSTESİ'], BASLIK, ...satirlar]), 'EK-4A');
  return Buffer.from(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));
}

// Örnek reçetelerdeki ilaçlar ve bir yenisi; KARDIOX'un eski barkodu da listede.
const satirlar = (ek: unknown[][] = []) => [
  ['A90001', 8690000000011, 'KARDIOX 75 MG 28 TABLET', 8690000000004, null, 'E001A'],
  ['A90002', 8690000000028, 'ONKOMAB 100 MG FLAKON', null, null, null],
  ['A90003', 8690000000035, 'PSIKOLAN 10 MG 30 TABLET', null, null, null],
  ['A90005', 8690000000059, 'YENIKOR 5 MG 30 TABLET', null, null, null],
  ...ek,
];

async function ortam() {
  const o = await kur();
  const eczaci = await girisYap(o.app, o.kullanicilar.eczaci.eposta);
  const calisan = await girisYap(o.app, o.kullanicilar.calisan.eposta);
  return { ...o, eczaci, calisan };
}

describe('EK-4/A yükleme', () => {
  it('yüklenen liste kontrolde hemen kullanılır', async () => {
    const o = await ortam();
    expect((await o.eczaci('GET', '/api/ek4a')).json().aktif).toMatchObject({ yayimTarihi: '2026-10-15', ornek: true });

    const y = await o.app.inject({
      method: 'POST',
      url: '/api/ek4a?yayimTarihi=2026-10-18&dosyaAdi=ek4a.xlsx',
      payload: dosya(satirlar([['A9', 8690000000059, 'YENIKOR TEKRAR', null, null, null]])),
      headers: { 'content-type': 'application/octet-stream', cookie: await cerez(o) },
    });
    expect(y.statusCode).toBe(201);
    expect(y.json()).toMatchObject({ surum: { yayimTarihi: '2026-10-18', kayitSayisi: 4, yukleyen: 'Ecz. Serkan Kaya' } });
    expect(y.json().uyarilar).toContain('1 barkod dosyada birden çok kez geçiyor; ilki alındı');

    const bilgi = (await o.eczaci('GET', '/api/ek4a')).json();
    expect(bilgi.aktif).toMatchObject({ yayimTarihi: '2026-10-18', kayitSayisi: 4, ornek: false });
    expect(bilgi.surumler).toHaveLength(1);
    expect((await o.calisan('GET', '/api/ek4a/ara?q=yenikor')).json()).toEqual([{ barkod: '8690000000059', ad: 'YENIKOR 5 MG 30 TABLET', kamuNo: 'A90005', eskiBarkodlar: [] }]);
    expect((await o.calisan('GET', '/api/ek4a/ara?q=8690000000004')).json()[0].ad).toBe('KARDIOX 75 MG 28 TABLET');

    // GENELOL yeni listede yok: artık kırmızı.
    const recete = {
      no: 'E-9', tarih: '2026-10-20', tur: 'normal', hekim: { ad: 'Dr', brans: 'Aile Hekimliği' }, tanilar: [], raporlar: [],
      kalemler: [{ barkod: '8690000000042', ad: 'GENELOL', etkenMadde: 'ÖRNEKMADDE-D', adet: 1 }],
    };
    const k = (await o.calisan('POST', '/api/kontrol', { recete })).json();
    expect(k.ek4aYayimTarihi).toBe('2026-10-18');
    expect(k.bulgular.map((b: { kuralId: string }) => b.kuralId)).toContain('EK4A_LISTE');
  });

  it('yalnızca kural yetkili eczacı yükler; bozuk, eski ya da çok küçük liste reddedilir', async () => {
    const o = await ortam();
    const gonder = async (govde: Buffer, sorgu: string, kim: 'eczaci' | 'calisan' = 'eczaci') =>
      o.app.inject({
        method: 'POST',
        url: `/api/ek4a?${sorgu}`,
        payload: govde,
        headers: { 'content-type': 'application/octet-stream', cookie: await cerez(o, kim) },
      });
    expect((await gonder(dosya(satirlar()), 'yayimTarihi=2026-10-18', 'calisan')).statusCode).toBe(403);
    expect((await gonder(dosya(satirlar()), 'yayimTarihi=2026-10-30')).statusCode).toBe(400);
    expect((await gonder(Buffer.from('bu bir excel değil'), 'yayimTarihi=2026-10-18')).statusCode).toBe(400);
    expect((await gonder(dosya([]), 'yayimTarihi=2026-10-18')).statusCode).toBe(400);

    expect((await gonder(dosya(satirlar()), 'yayimTarihi=2026-10-18')).statusCode).toBe(201);
    expect((await gonder(dosya(satirlar()), 'yayimTarihi=2026-10-01')).statusCode).toBe(409);
    const kucuk = await gonder(dosya(satirlar().slice(0, 1)), 'yayimTarihi=2026-10-19');
    expect(kucuk.statusCode).toBe(409);
    expect(kucuk.json().onayGerekli).toBe(true);
    expect((await gonder(dosya(satirlar().slice(0, 1)), 'yayimTarihi=2026-10-19&zorla=1')).statusCode).toBe(201);
  });
});

async function cerez(o: Awaited<ReturnType<typeof kur>>, kim: 'eczaci' | 'calisan' = 'eczaci') {
  const r = await o.app.inject({ method: 'POST', url: '/api/giris', payload: { eposta: o.kullanicilar[kim].eposta, parola: PAROLA } });
  return String(r.headers['set-cookie']).split(';')[0]!;
}
