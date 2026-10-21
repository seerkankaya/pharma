import { describe, expect, it } from 'vitest';
import { gs1Tarih, gtinGecerli, karekodAyristir, KarekodHatasi } from '../src/its/karekod.js';
import { islemUygula, ItsHatasi, sonucuIsle, stokKarsilastir, type ItsBildirimi, type TekilUrun } from '../src/its/its.js';
import { girisYap, kur } from './yardimci.js';

const GS = '\x1d';
const GTIN = '08699512345673';
const BARKOD = '8699512345673';
const DEPO = { gln: '8680000000017', ad: 'Örnek Ecza Deposu' };
const karekod = (seri: string, skt = '280531', parti = 'P123') => `01${GTIN}21${seri}${GS}17${skt}10${parti}`;
const bilgi = { bildirimId: 'B1', zaman: '2026-10-20T09:00:00.000Z', kaydeden: 'Ecz. Serkan Kaya', bugun: '2026-10-20' };

describe('karekod', () => {
  it('GS ayırıcılı karekodu alanlarına ayırır', () => {
    expect(karekodAyristir(karekod('ABC123'))).toEqual({ gtin: GTIN, barkod: BARKOD, seriNo: 'ABC123', skt: '2028-05-31', partiNo: 'P123' });
  });

  it('parantezli, "<GS>" yazılı ve sembol önekli biçimleri okur; alan sırası değişebilir', () => {
    expect(karekodAyristir(`(01)${GTIN}(21)S1(17)280500(10)L9`)).toMatchObject({ seriNo: 'S1', skt: '2028-05-31', partiNo: 'L9' });
    expect(karekodAyristir(`]d201${GTIN}17280531` + `10L9<GS>21S2`)).toMatchObject({ seriNo: 'S2', partiNo: 'L9' });
  });

  it('ayırıcısız okunan karekodu tek olasılık varsa tahminle böler', () => {
    expect(karekodAyristir(`01${GTIN}21XYZ9871728053110LOT5`)).toEqual({
      gtin: GTIN,
      barkod: BARKOD,
      seriNo: 'XYZ987',
      skt: '2028-05-31',
      partiNo: 'LOT5',
      tahmini: true,
    });
  });

  it('hatalı karekodu reddeder', () => {
    expect(() => karekodAyristir(`0108699512345742` + `21S1${GS}17280531` + '10P')).toThrow('GTIN geçersiz');
    expect(() => karekodAyristir(`01${GTIN}21S1`)).toThrow(KarekodHatasi);
    expect(() => karekodAyristir(`(01)${GTIN}(21)S1`)).toThrow('GTIN, seri no');
    expect(() => karekodAyristir(`01${GTIN}21S1${GS}17281331${'10'}P`)).toThrow('ay geçersiz');
    expect(() => karekodAyristir(`99${GTIN}`)).toThrow('Tanınmayan');
    expect(gtinGecerli('08699512345741')).toBe(true);
    expect(gtinGecerli('08699512345742')).toBe(false);
    expect(gs1Tarih('280200')).toBe('2028-02-29');
  });
});

describe('İTS iş kuralları', () => {
  const k1 = karekodAyristir(karekod('S1'));
  const k2 = karekodAyristir(karekod('S2'));

  it('alım kutuları stoğa alır ve bildirim hazırlar; aynı kutu ikinci kez alınamaz', () => {
    const { tekiller, bildirim } = islemUygula({ tur: 'alim', karekodlar: [k1, k2], karsiTaraf: DEPO, belgeNo: 'F-1' }, new Map(), bilgi);
    expect(tekiller.map((t) => [t.id, t.durum])).toEqual([
      [`${GTIN}:S1`, 'stokta'],
      [`${GTIN}:S2`, 'stokta'],
    ]);
    expect(bildirim).toMatchObject({ tur: 'alim', durum: 'bekliyor', deneme: 0, karsiTaraf: DEPO, belgeNo: 'F-1' });
    const mevcut = new Map(tekiller.map((t) => [t.id, t]));
    expect(() => islemUygula({ tur: 'alim', karekodlar: [k1], karsiTaraf: DEPO }, mevcut, bilgi)).toThrow(ItsHatasi);
  });

  it('stokta olmayan kutu satılamaz; bir kutu uymazsa hiçbiri değişmez', () => {
    const { tekiller } = islemUygula({ tur: 'alim', karekodlar: [k1], karsiTaraf: DEPO }, new Map(), bilgi);
    const mevcut = new Map(tekiller.map((t) => [t.id, t]));
    try {
      islemUygula({ tur: 'satis', karekodlar: [k1, k2] }, mevcut, bilgi);
      expect.unreachable();
    } catch (e) {
      expect((e as ItsHatasi).hatalar).toEqual([`${BARKOD} / S2: kutu eczanede kaydı yok, bu işlem yapılamaz`]);
    }
    const satis = islemUygula({ tur: 'satis', karekodlar: [k1] }, mevcut, bilgi);
    expect(satis.tekiller[0]).toMatchObject({ durum: 'satildi', hareketler: [{ tur: 'alim' }, { tur: 'satis' }] });
  });

  it('miadı geçmiş kutu satılamaz ama deaktive edilebilir', () => {
    const eski = karekodAyristir(karekod('E1', '261001'));
    const mevcut = new Map(islemUygula({ tur: 'alim', karekodlar: [eski], karsiTaraf: DEPO }, new Map(), bilgi).tekiller.map((t) => [t.id, t]));
    expect(() => islemUygula({ tur: 'satis', karekodlar: [eski] }, mevcut, bilgi)).toThrow(ItsHatasi);
    const d = islemUygula({ tur: 'deaktivasyon', karekodlar: [eski], neden: { kod: '1', aciklama: 'Miadı geçti' } }, mevcut, bilgi);
    expect(d.tekiller[0]!.durum).toBe('deaktive');
    expect(d.bildirim.neden).toEqual({ kod: '1', aciklama: 'Miadı geçti' });
  });

  it('İTS yanıtını işler: ulaşılamazsa hata, reddedilen kutu varsa reddedildi', () => {
    const b = islemUygula({ tur: 'alim', karekodlar: [k1], karsiTaraf: DEPO }, new Map(), bilgi).bildirim;
    expect(sonucuIsle(b, { ulasildi: false, sonuclar: [] }, 'z')).toMatchObject({ durum: 'hata', hata: "İTS'ye ulaşılamadı" });
    const red = sonucuIsle(b, { ulasildi: true, sonuclar: [{ gtin: GTIN, seriNo: 'S1', basarili: false, kod: '10', mesaj: 'x' }] }, 'z');
    expect(red).toMatchObject({ durum: 'reddedildi', reddedilenler: [{ seriNo: 'S1' }] });
    const tamam: ItsBildirimi = sonucuIsle(red, { ulasildi: true, sonuclar: [{ gtin: GTIN, seriNo: 'S1', basarili: true }] }, 'z');
    expect(tamam.durum).toBe('gonderildi');
    expect(tamam.reddedilenler).toBeUndefined();
  });

  it('İTS ve yerel stok karşılaştırması', () => {
    const t = (seri: string, durum: TekilUrun['durum']): TekilUrun => ({
      id: `${GTIN}:${seri}`,
      gtin: GTIN,
      barkod: BARKOD,
      seriNo: seri,
      skt: '2028-05-31',
      partiNo: 'P',
      durum,
      hareketler: [],
    });
    const sonuc = stokKarsilastir(
      [t('S1', 'stokta'), t('S2', 'stokta'), t('S3', 'satildi')],
      [
        { gtin: GTIN, seriNo: 'S1' },
        { gtin: GTIN, seriNo: 'S3' },
        { gtin: GTIN, seriNo: 'S9' },
      ],
      new Map([[BARKOD, [{ partiNo: 'P', skt: '2028-05-31', miktar: 3 }]]]),
    );
    expect(sonuc.sadeceYerelde.map((x) => x.seriNo)).toEqual(['S2']);
    expect(sonuc.sadeceItsde).toEqual([
      { gtin: GTIN, seriNo: 'S3', yerelDurum: 'satildi' },
      { gtin: GTIN, seriNo: 'S9' },
    ]);
    expect(sonuc.adetFarklari).toEqual([{ barkod: BARKOD, karekodlu: 2, stokta: 3 }]);
  });
});

describe('İTS API', () => {
  it('karekod okutma, alım, satış, bildirim gönderimi ve karşılaştırma', async () => {
    const { app, its, kullanicilar } = await kur();
    const ecz = await girisYap(app, kullanicilar.eczaci.eposta);

    const oku = await ecz('POST', '/api/its/karekod', { karekod: karekod('S1') });
    expect(oku.json()).toMatchObject({ karekod: { barkod: BARKOD, seriNo: 'S1' }, durum: null, miadiGecmis: false });
    expect((await ecz('POST', '/api/its/karekod', { karekod: 'bozuk' })).statusCode).toBe(400);

    const alim = await ecz('POST', '/api/its/islem', { tur: 'alim', karekodlar: [karekod('S1'), karekod('S2')], karsiTaraf: DEPO, belgeNo: 'F-1' });
    expect(alim.statusCode).toBe(201);
    expect((await ecz('POST', '/api/its/islem', { tur: 'alim', karekodlar: [karekod('S1')] })).json().hatalar).toContain(
      'Deponun 13 haneli GLN numarasını girin',
    );
    expect((await ecz('POST', '/api/its/islem', { tur: 'alim', karekodlar: [karekod('S1')], karsiTaraf: DEPO })).statusCode).toBe(409);

    // İTS kapalıyken bildirim kuyrukta kalır ve tekrar denenir.
    its.kapali = true;
    expect((await ecz('POST', '/api/its/bildirimler/gonder')).json()).toEqual({ gonderildi: 0, reddedildi: 0, hata: 1 });
    its.kapali = false;
    expect((await ecz('POST', '/api/its/bildirimler/gonder')).json()).toEqual({ gonderildi: 1, reddedildi: 0, hata: 0 });
    expect((await ecz('POST', '/api/its/bildirimler/gonder')).json()).toEqual({ gonderildi: 0, reddedildi: 0, hata: 0 });

    expect((await ecz('POST', '/api/its/islem', { tur: 'satis', karekodlar: [karekod('S1')], belgeNo: 'R-1' })).statusCode).toBe(201);
    await ecz('POST', '/api/its/bildirimler/gonder');
    const bildirimler = (await ecz('GET', '/api/its/bildirimler')).json() as ItsBildirimi[];
    expect(bildirimler.map((b) => [b.tur, b.durum, b.deneme])).toEqual([
      ['satis', 'gonderildi', 1],
      ['alim', 'gonderildi', 2],
    ]);
    expect((await ecz('GET', '/api/its/tekiller?durum=stokta')).json().map((t: TekilUrun) => t.seriNo)).toEqual(['S2']);

    const k = (await ecz('GET', '/api/its/karsilastirma')).json();
    expect(k.sadeceYerelde).toEqual([]);
    expect(k.sadeceItsde).toEqual([]);
    expect(k.adetFarklari).toEqual([{ barkod: BARKOD, karekodlu: 1, stokta: 0 }]);
  });

  it('İTS bir kutuyu reddederse bildirim reddedildi olarak kalır', async () => {
    const { app, its, kullanicilar, eczaneler } = await kur();
    const ecz = await girisYap(app, kullanicilar.eczaci.eposta);
    its.stogaKoy(eczaneler.kaya.id, { gtin: GTIN, seriNo: 'S1' });
    await ecz('POST', '/api/its/islem', { tur: 'alim', karekodlar: [karekod('S1')], karsiTaraf: DEPO });
    expect((await ecz('POST', '/api/its/bildirimler/gonder')).json()).toEqual({ gonderildi: 0, reddedildi: 1, hata: 0 });
    const [b] = (await ecz('GET', '/api/its/bildirimler')).json() as ItsBildirimi[];
    expect(b!.reddedilenler).toEqual([{ gtin: GTIN, seriNo: 'S1', basarili: false, kod: 'SAHTE-1', mesaj: 'Ürün zaten eczanenin üzerinde' }]);
  });

  it('deaktivasyon ve iadeyi yalnızca eczacı yapar; eczaneler birbirinin kutusunu görmez', async () => {
    const { app, kullanicilar } = await kur();
    const ecz = await girisYap(app, kullanicilar.eczaci.eposta);
    const calisan = await girisYap(app, kullanicilar.calisan.eposta);
    const baska = await girisYap(app, kullanicilar.baskaEczane.eposta);
    await calisan('POST', '/api/its/islem', { tur: 'alim', karekodlar: [karekod('S1')], karsiTaraf: DEPO });
    const neden = { kod: '1', aciklama: 'Kırık ambalaj' };
    expect((await calisan('POST', '/api/its/islem', { tur: 'deaktivasyon', karekodlar: [karekod('S1')], neden })).statusCode).toBe(403);
    expect((await calisan('GET', '/api/its/karsilastirma')).statusCode).toBe(403);
    expect((await ecz('POST', '/api/its/islem', { tur: 'deaktivasyon', karekodlar: [karekod('S1')], neden: { kod: '', aciklama: '' } })).statusCode).toBe(400);
    expect((await ecz('POST', '/api/its/islem', { tur: 'deaktivasyon', karekodlar: [karekod('S1')], neden })).statusCode).toBe(201);
    expect((await baska('GET', '/api/its/tekiller')).json()).toEqual([]);
    expect((await baska('POST', '/api/its/karekod', { karekod: karekod('S1') })).json().durum).toBeNull();
  });
});
