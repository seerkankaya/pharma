import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ornekIlacKurallari, ornekReceteler, type IlacKurali, type KontrolSonucu } from '@scalpiq/sut-motoru';
import { EpostaKullanimdaHatasi } from '../src/hesap.js';
import type { DenetimKaydi } from '../src/kontrol-deposu.js';
import { gocleriUygula, havuzOlustur, type Havuz } from '../src/vt/baglanti.js';
import { PgHesapDeposu, PgKontrolDeposu, PgKuralDeposu } from '../src/vt/pg-depolar.js';
import { PgStokDeposu } from '../src/vt/pg-stok-deposu.js';
import { FaturaZatenVarHatasi } from '../src/stok/stok-deposu.js';
import type { AlisFaturasi } from '../src/alis/alis.js';
import { PgCariDeposu } from '../src/vt/pg-cari-deposu.js';
import { CariHatasi } from '../src/cari/cari.js';
import { StokHatasi, type StokHareketi } from '../src/stok/stok.js';
import { PgGunSonuDeposu } from '../src/vt/pg-gun-sonu-deposu.js';
import { PgEk4aDeposu } from '../src/vt/pg-ek4a-deposu.js';
import { GunZatenKapaliHatasi, type GunSonu } from '../src/rapor/rapor.js';
import { PgBelgeDeposu } from '../src/vt/pg-belge-deposu.js';

// PostgreSQL depolarının testleri. Yalnızca TEST_DATABASE_URL verildiğinde çalışır;
// veritabanındaki her şeyi siler, bu yüzden yalnızca test için açılmış bir veritabanı verin.
const adres = process.env.TEST_DATABASE_URL;

describe.skipIf(!adres)('PostgreSQL depoları', () => {
  let havuz: Havuz;

  beforeAll(async () => {
    havuz = havuzOlustur(adres!);
    await havuz.query('drop schema public cascade; create schema public;');
    expect(await gocleriUygula(havuz)).toEqual(['001_ilk.sql', '002_stok.sql', '003_alis.sql', '004_cari.sql', '005_gun_sonu.sql', '006_ek4a.sql', '007_ek4a_pasif.sql', '008_its.sql', '009_depo.sql', '010_emanet.sql', '011_gelir_gider.sql', '012_recete_satisi.sql', '013_etkilesim.sql']);
  });
  afterAll(() => havuz?.end());

  it('göçleri bir kez uygular', async () => {
    expect(await gocleriUygula(havuz)).toEqual([]);
  });

  async function eczaneVeKullanici(eposta = `${randomUUID()}@test.local`) {
    const h = new PgHesapDeposu(havuz);
    const e = await h.eczaneEkle('Test Eczanesi');
    const k = await h.kullaniciEkle({ eczaneId: e.id, eposta, adSoyad: 'Test Eczacı', rol: 'eczaci', kuralYetkisi: false, parolaOzeti: 'x' });
    return { h, e, k };
  }

  it('hesaplar: e-posta tekildir, oturum süresi ve kapatılan kullanıcı', async () => {
    const { h, e, k } = await eczaneVeKullanici('Tek@Test.local');
    expect(k.eposta).toBe('tek@test.local');
    await expect(h.kullaniciEkle({ ...k, eposta: 'TEK@test.local' })).rejects.toBeInstanceOf(EpostaKullanimdaHatasi);
    expect((await h.epostaylaBul(' tek@TEST.local'))?.id).toBe(k.id);

    const simdi = new Date();
    await h.oturumEkle('ozet-1', k.id, new Date(simdi.getTime() + 60_000));
    expect(await h.oturumBul('ozet-1', simdi)).toMatchObject({ id: k.id, eczaneAd: 'Test Eczanesi', rol: 'eczaci' });
    expect(await h.oturumBul('ozet-1', new Date(simdi.getTime() + 120_000))).toBeUndefined();

    expect(await h.kullaniciDurumu(k.id, randomUUID(), false)).toBe(false);
    expect(await h.kullaniciDurumu(k.id, e.id, false)).toBe(true);
    expect(await h.oturumBul('ozet-1', simdi)).toBeUndefined();
  });

  it('kurallar: onaylı kural silinemez ve yalnızca geçerliliği bir kez kapatılabilir', async () => {
    const depo = new PgKuralDeposu(havuz);
    await depo.bossaDoldur(ornekIlacKurallari);
    await depo.bossaDoldur([{ ...ornekIlacKurallari[0]!, id: 'IKINCI' }]);
    expect((await depo.listele()).map((k) => k.id)).toEqual(ornekIlacKurallari.map((k) => k.id).sort());

    const onayli: IlacKurali = {
      ...ornekIlacKurallari[0]!,
      id: 'ONAYLI',
      ornek: undefined,
      onay: { onaylayan: 'Ecz. A', tarih: '2026-01-01' },
    };
    await depo.degistir(() => ({ sonuc: null, kaydet: [onayli] }));

    await expect(depo.degistir(() => ({ sonuc: null, sil: ['ONAYLI'] }))).rejects.toThrow('Onaylı kural silinemez');
    await expect(depo.degistir(() => ({ sonuc: null, kaydet: [{ ...onayli, maksGunlukDoz: 999 }] }))).rejects.toThrow('değiştirilemez');

    const kapali = { ...onayli, gecerlilik: { ...onayli.gecerlilik, bitis: '2026-12-31' } };
    await depo.degistir(() => ({ sonuc: null, kaydet: [kapali] }));
    await expect(
      depo.degistir(() => ({ sonuc: null, kaydet: [{ ...kapali, gecerlilik: { ...kapali.gecerlilik, bitis: '2027-12-31' } }] })),
    ).rejects.toThrow('değiştirilemez');
    expect((await depo.listele()).find((k) => k.id === 'ONAYLI')?.gecerlilik.bitis).toBe('2026-12-31');
  });

  it('kurallar: aynı anda yapılan değişiklikler birbirini ezmez', async () => {
    const depo = new PgKuralDeposu(havuz);
    const once = (await depo.listele()).length;
    await Promise.all(
      [1, 2, 3, 4, 5].map((i) =>
        depo.degistir((kurallar) => ({ sonuc: null, kaydet: [{ ...ornekIlacKurallari[0]!, id: `ES-${i}-${kurallar.length}` }] })),
      ),
    );
    const ids = (await depo.listele()).filter((k) => k.id.startsWith('ES-')).map((k) => Number(k.id.split('-')[2]));
    // Her işlem bir öncekinin eklediğini görmüş olmalı.
    expect(ids.sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4].map((n) => once + n));
  });

  it('kontroller: tek gönderim, denetim kaydı ve eczane ayrımı', async () => {
    const { e, k } = await eczaneVeKullanici();
    const depo = new PgKontrolDeposu(havuz);
    const id = randomUUID();
    const recete = ornekReceteler[0]!.recete;
    const sonuc: KontrolSonucu = { receteNo: recete.no, durum: 'yesil', bulgular: [], kontrolTarihi: '2026-10-20', ek4aYayimTarihi: '2026-10-01' };
    await depo.ekle({ id, eczaneId: e.id, kullaniciId: k.id, recete, sonuc });

    expect(await depo.al(id, randomUUID())).toBeUndefined();
    expect(await depo.al('uuid-degil', e.id)).toBeUndefined();
    expect((await depo.al(id, e.id))?.durum).toBe('bekliyor');

    const yarislar = await Promise.all([depo.gonderimiBaslat(id), depo.gonderimiBaslat(id)]);
    expect(yarislar.filter(Boolean)).toHaveLength(1);
    await depo.gonderimiBirak(id);
    expect(await depo.gonderimiBaslat(id)).toBe(true);

    const kayit: DenetimKaydi = {
      zaman: new Date().toISOString(),
      kontrolId: id,
      receteNo: recete.no,
      gonderen: 'Test Eczacı',
      durum: 'yesil',
      bulgular: [],
      gerekceler: {},
      ek4aYayimTarihi: '2026-10-01',
      takipNo: 'T-1',
    };
    await depo.gonderimiTamamla(id, kayit);
    expect(await depo.al(id, e.id)).toMatchObject({ durum: 'gonderildi', takipNo: 'T-1' });
    await expect(depo.gonderimiTamamla(id, kayit)).rejects.toThrow();
    expect(await depo.denetimKayitlari(e.id)).toEqual([kayit]);

    await expect(havuz.query('update denetim set kayit = $1', ['{}'])).rejects.toThrow('Denetim kaydı değiştirilemez');
    await expect(havuz.query('delete from denetim')).rejects.toThrow('Denetim kaydı değiştirilemez');
    await expect(havuz.query('truncate denetim')).rejects.toThrow();
  });

  it('stok: ürün kartı, partiler, sıralı işlem ve değişmez hareketler', async () => {
    const { e, k } = await eczaneVeKullanici();
    const depo = new PgStokDeposu(havuz);
    const barkod = '8690000000001';
    await depo.urunKaydet(e.id, { barkod, ad: 'Krem', ilac: false, kdvOrani: 20, satisFiyatiKurus: 100 });
    await depo.urunKaydet(e.id, { barkod, ad: 'Krem 50 ml', ilac: false, kdvOrani: 20, satisFiyatiKurus: 120 });
    expect(await depo.urunler(e.id)).toEqual([{ barkod, ad: 'Krem 50 ml', ilac: false, kdvOrani: 20, satisFiyatiKurus: 120 }]);

    const h = (miktar: number, partiNo: string, skt: string, tur: StokHareketi['tur'] = 'giris'): StokHareketi => ({
      barkod, tur, miktar, partiNo, skt, kullaniciId: k.id, zaman: new Date().toISOString(),
    });
    await depo.islem(e.id, [barkod], () => ({ sonuc: null, hareketler: [h(5, 'B', '2027-06-30'), h(2, 'A', '2026-11-30')] }));
    expect((await depo.stok(e.id)).get(barkod)).toEqual([
      { partiNo: 'A', skt: '2026-11-30', miktar: 2 },
      { partiNo: 'B', skt: '2027-06-30', miktar: 5 },
    ]);

    // Hata fırlatan işlem hiçbir şey yazmaz.
    await expect(
      depo.islem(e.id, [barkod], () => {
        throw new StokHatasi('yetersiz');
      }),
    ).rejects.toThrow('yetersiz');

    // Aynı anda 7 işlem birer kutu düşer; her biri bir öncekinin düştüğünü görür.
    const gorulen = await Promise.all(
      Array.from({ length: 7 }, () =>
        depo.islem(e.id, [barkod], (p) => {
          const toplam = (p.get(barkod) ?? []).reduce((t, x) => t + x.miktar, 0);
          const ilk = p.get(barkod)![0]!;
          return { sonuc: toplam, hareketler: [h(-1, ilk.partiNo, ilk.skt, 'imha')] };
        }),
      ),
    );
    expect(gorulen.sort((a, b) => b - a)).toEqual([7, 6, 5, 4, 3, 2, 1]);
    expect((await depo.stok(e.id)).get(barkod)).toEqual([]);

    await expect(havuz.query('update stok_hareketi set miktar = 100')).rejects.toThrow('değiştirilemez');
    await expect(havuz.query('delete from stok_hareketi')).rejects.toThrow('değiştirilemez');
    await expect(havuz.query('truncate satis cascade')).rejects.toThrow('değiştirilemez');
  });

  it('alış: fatura, yeni kart ve stok tek işlemde; aynı fatura iki kez girilemez', async () => {
    const { e, k } = await eczaneVeKullanici();
    const depo = new PgStokDeposu(havuz);
    const t = await depo.tedarikciEkle(e.id, { ad: 'Depo', vergiNo: '1234567890' });
    expect(await depo.tedarikciler(e.id)).toEqual([t]);
    const barkod = '8690000000009';
    const fatura = {
      id: randomUUID(), tedarikciId: t.id, tedarikciAd: 'Depo', faturaNo: 'F-1', tarih: '2026-10-19', kalemler: [],
      netKurus: 0, kdvKurus: 0, toplamKurus: 0, kaydeden: 'X', zaman: new Date().toISOString(),
    } as AlisFaturasi;
    const yaz = (f: AlisFaturasi) =>
      depo.islem(e.id, [barkod], () => ({
        sonuc: null,
        fatura: f,
        yeniUrunler: [{ barkod, ad: 'Yeni', ilac: false, kdvOrani: 20 as const, satisFiyatiKurus: 500 }],
        hareketler: [{ barkod, tur: 'giris' as const, miktar: 3, partiNo: 'P', skt: '2027-01-01', faturaId: f.id, kullaniciId: k.id, zaman: f.zaman }],
      }));
    await yaz(fatura);
    await expect(yaz({ ...fatura, id: randomUUID() })).rejects.toBeInstanceOf(FaturaZatenVarHatasi);
    expect((await depo.stok(e.id)).get(barkod)).toEqual([{ partiNo: 'P', skt: '2027-01-01', miktar: 3 }]);
    expect((await depo.urunler(e.id)).map((u) => u.ad)).toEqual(['Yeni']);
    expect((await depo.faturalar(e.id)).map((f) => f.faturaNo)).toEqual(['F-1']);
    await expect(havuz.query('delete from alis_faturasi')).rejects.toThrow('değiştirilemez');
  });

  it('cari: veresiye borcu satışla aynı işlemde, limit ve tahsilat kilit altında', async () => {
    const { e, k } = await eczaneVeKullanici();
    const cari = new PgCariDeposu(havuz);
    const stok = new PgStokDeposu(havuz);
    const m = await cari.musteriEkle(e.id, { adSoyad: 'Ahmet', limitKurus: 1000 });
    expect(await cari.musteriAl(e.id, m.id)).toEqual(m);
    const satis = (tutar: number) => {
      const id = randomUUID();
      const zaman = new Date().toISOString();
      return stok.islem(e.id, [], () => ({
        sonuc: null,
        satis: { id, zaman, kullaniciId: k.id, satan: 'X', odemeTuru: 'veresiye' as const, kalemler: [], toplamKurus: tutar, kdvKurus: 0 },
        cariBorc: {
          musteriAd: 'Ahmet',
          limitKurus: 1000,
          hareket: { musteriId: m.id, tur: 'borc' as const, tutarKurus: tutar, satisId: id, kullaniciId: k.id, kaydeden: 'X', zaman },
        },
      }));
    };
    const sonuc = await Promise.allSettled([satis(600), satis(600)]);
    expect(sonuc.map((x) => x.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect((await cari.musteriler(e.id))[0]).toMatchObject({ adSoyad: 'Ahmet', bakiyeKurus: 600, limitKurus: 1000 });
    // Reddedilen satışın satış kaydı da yazılmamalı.
    expect((await havuz.query('select count(*)::int as n from satis where eczane_id = $1', [e.id])).rows[0].n).toBe(1);

    const tahsil = (tutar: number) =>
      cari.tahsilat(e.id, { musteriId: m.id, tur: 'tahsilat', tutarKurus: tutar, odemeTuru: 'nakit', kullaniciId: k.id, kaydeden: 'X', zaman: new Date().toISOString() });
    await expect(tahsil(700)).rejects.toBeInstanceOf(CariHatasi);
    expect(await tahsil(600)).toBe(0);
    expect((await cari.hareketler(e.id, m.id)).map((h) => h.tur)).toEqual(['tahsilat', 'borc']);
    await expect(havuz.query('delete from cari_hareket')).rejects.toThrow('değiştirilemez');

    const gun = new Date(Date.now() - 60_000);
    expect((await cari.tahsilatlar(e.id, gun, new Date(Date.now() + 60_000))).map((h) => h.tutarKurus)).toEqual([600]);
    expect(await cari.tahsilatlar(e.id, new Date(0), gun)).toEqual([]);
  });

  it('raporlar: giriş maliyetleri ve bir kez kapanan, değişmeyen gün sonu', async () => {
    const { e, k } = await eczaneVeKullanici();
    const stok = new PgStokDeposu(havuz);
    const zaman = new Date().toISOString();
    const giris = (partiNo: string, birimMaliyetKurus?: number): StokHareketi => ({
      barkod: '8690000000003', tur: 'giris', miktar: 4, partiNo, skt: '2027-03-31', birimMaliyetKurus, kullaniciId: k.id, zaman,
    });
    await stok.islem(e.id, ['8690000000003'], () => ({ sonuc: null, hareketler: [giris('A', 250), giris('B')] }));
    expect((await stok.girisler(e.id)).sort((a, b) => a.partiNo.localeCompare(b.partiNo))).toEqual([
      { ...giris('A', 250) },
      (({ birimMaliyetKurus: _b, ...g }) => g)(giris('B')),
    ]);

    const depo = new PgGunSonuDeposu(havuz);
    const g: GunSonu = {
      gun: '2026-10-20', zaman, kullaniciId: k.id, kapatan: 'X', satisAdedi: 0, ciroKurus: 0, veresiyeKurus: 0,
      kasa: { nakitSatisKurus: 0, nakitTahsilatKurus: 0, kartSatisKurus: 0, kartTahsilatKurus: 0, beklenenNakitKurus: 0, beklenenKartKurus: 0 },
      sayilanNakitKurus: 0, farkKurus: 0,
    };
    await depo.kapat(e.id, g);
    await expect(depo.kapat(e.id, g)).rejects.toBeInstanceOf(GunZatenKapaliHatasi);
    expect(await depo.al(e.id, '2026-10-20')).toEqual(g);
    expect(await depo.al(e.id, '2026-10-21')).toBeUndefined();
    expect(await depo.liste(e.id, 10)).toEqual([g]);
    await expect(havuz.query('update gun_sonu set fark_kurus = 5')).rejects.toThrow('değiştirilemez');
  });

  it('EK-4/A: sürümler eklenir, en son yayımlanan aktiftir, kayıtlar değişmez', async () => {
    const { k } = await eczaneVeKullanici();
    const depo = new PgEk4aDeposu(havuz);
    expect(await depo.aktif()).toBeUndefined();
    const kayit = (barkod: string, ad: string, eski: string[] = []) => ({ barkod, ad, eskiBarkodlar: eski });
    // Parça sınırını aşan bir liste: tek sorguda yazılamaz.
    const cok = Array.from({ length: 4500 }, (_, i) => kayit(String(8690000100000 + i), `ILAC ${i}`));
    await depo.ekle({ yayimTarihi: '2026-09-01', yukleyen: 'X', kullaniciId: k.id }, cok);
    const yeni = await depo.ekle({ yayimTarihi: '2026-10-01', dosyaAdi: 'ek4a.xlsx', yukleyen: 'Y', kullaniciId: k.id }, [
      { ...kayit('8690000000011', 'KARDIOX', ['8690000000004']), kamuNo: 'A1', esdegerGrubu: 'E1' },
      { ...kayit('8690000000028', 'ONKOMAB'), pasifAraliklari: [{ baslangic: '2026-03-02', bitis: '2026-07-06' }, { baslangic: '2026-09-15' }] },
    ]);
    // Daha eski yayım tarihli sürüm sonradan yüklense de aktif olan en son yayımlanandır.
    await depo.ekle({ yayimTarihi: '2026-08-01', yukleyen: 'Z', kullaniciId: k.id }, [kayit('8690000000035', 'ESKI')]);
    const aktif = await depo.aktif();
    expect(aktif?.surum).toEqual(yeni);
    expect(aktif?.kayitlar).toEqual([
      { barkod: '8690000000011', ad: 'KARDIOX', kamuNo: 'A1', esdegerGrubu: 'E1', eskiBarkodlar: ['8690000000004'] },
      {
        barkod: '8690000000028',
        ad: 'ONKOMAB',
        eskiBarkodlar: [],
        pasifAraliklari: [{ baslangic: '2026-03-02', bitis: '2026-07-06' }, { baslangic: '2026-09-15' }],
      },
    ]);
    expect((await depo.surumler()).map((s) => [s.yayimTarihi, s.kayitSayisi])).toEqual([
      ['2026-10-01', 2],
      ['2026-09-01', 4500],
      ['2026-08-01', 1],
    ]);
    await expect(havuz.query('delete from ek4a_kaydi')).rejects.toThrow('değiştirilemez');
  });
  it('belge deposu: eczane başına ayrı, değişiklikler sırayla ve hata olursa yazılmaz', async () => {
    const { e } = await eczaneVeKullanici();
    const { e: baska } = await eczaneVeKullanici();
    const depo = new PgBelgeDeposu<{ id: string; sayi: number }>(havuz, 'its_tekil');
    expect(() => new PgBelgeDeposu(havuz, 'its_tekil; drop table x')).toThrow('Geçersiz tablo');

    await depo.degistir(e.id, [], () => ({ sonuc: null, yaz: [{ id: 'a', sayi: 1 }, { id: 'a', sayi: 2 }] }));
    expect(await depo.al(e.id, 'a')).toEqual({ id: 'a', sayi: 2 });
    expect(await depo.al(baska.id, 'a')).toBeUndefined();

    // Aynı belgeyi artıran 20 eşzamanlı işlem birbirinin yazdığını kaybetmez.
    await Promise.all(
      Array.from({ length: 20 }, () =>
        depo.degistir(e.id, ['a'], (m) => ({ sonuc: null, yaz: [{ id: 'a', sayi: m.get('a')!.sayi + 1 }] })),
      ),
    );
    expect((await depo.al(e.id, 'a'))!.sayi).toBe(22);

    await expect(
      depo.degistir(e.id, ['a'], () => {
        throw new Error('vazgeç');
      }),
    ).rejects.toThrow('vazgeç');
    expect(await depo.liste(e.id)).toEqual([{ id: 'a', sayi: 22 }]);
  });
  it('depo iadesi: stok çıkışı ve iade belgesi aynı işlemde; iade ve ödeme kayıtları değiştirilemez', async () => {
    const { e, k } = await eczaneVeKullanici();
    const depo = new PgStokDeposu(havuz);
    const iadeler = new PgBelgeDeposu<{ id: string; tedarikciId: string; belgeNo: string }>(havuz, 'depo_iade');
    const barkod = '8690000000011';
    const h = (tur: StokHareketi['tur'], miktar: number): StokHareketi => ({ barkod, tur, miktar, partiNo: 'P', skt: '2027-01-01', kullaniciId: k.id, zaman: new Date().toISOString() });
    await depo.islem(e.id, [barkod], () => ({ sonuc: null, hareketler: [h('giris', 5)] }));
    const belge = { id: randomUUID(), tedarikciId: 'D', belgeNo: 'I-1' };
    await depo.islem(e.id, [barkod], () => ({ sonuc: null, hareketler: [h('iade', -2)], belgeler: [{ tablo: 'depo_iade', belge }] }));
    expect((await depo.stok(e.id)).get(barkod)).toEqual([{ partiNo: 'P', skt: '2027-01-01', miktar: 3 }]);
    expect(await iadeler.liste(e.id)).toEqual([belge]);

    // Aynı depoya aynı numaralı ikinci iade yazılamaz; stok çıkışı da geri alınır.
    await expect(
      depo.islem(e.id, [barkod], () => ({ sonuc: null, hareketler: [h('iade', -1)], belgeler: [{ tablo: 'depo_iade', belge: { ...belge, id: randomUUID() } }] })),
    ).rejects.toMatchObject({ code: '23505' });
    expect((await depo.stok(e.id)).get(barkod)![0]!.miktar).toBe(3);

    await expect(iadeler.degistir(e.id, [belge.id], () => ({ sonuc: null, yaz: [{ ...belge, belgeNo: 'X' }] }))).rejects.toThrow('değiştirilemez');
    await expect(havuz.query('delete from depo_odeme')).resolves.toBeDefined();
    await new PgBelgeDeposu(havuz, 'depo_odeme').degistir(e.id, [], () => ({ sonuc: null, yaz: [{ id: 'o1' }] }));
    await expect(havuz.query('delete from depo_odeme')).rejects.toThrow('değiştirilemez');
  });
  it('emanet hareketi stoktan düşer, emanet belgesi aynı işlemde yazılır', async () => {
    const { e, k } = await eczaneVeKullanici();
    const depo = new PgStokDeposu(havuz);
    const barkod = '8690000000012';
    const h = (tur: StokHareketi['tur'], miktar: number): StokHareketi => ({ barkod, tur, miktar, partiNo: 'P', skt: '2027-01-01', kullaniciId: k.id, zaman: new Date().toISOString() });
    await depo.islem(e.id, [barkod], () => ({ sonuc: null, hareketler: [h('giris', 4)] }));
    await depo.islem(e.id, [barkod], () => ({ sonuc: null, hareketler: [h('emanet', -3)], belgeler: [{ tablo: 'emanet', belge: { id: 'E1', durum: 'acik' } }] }));
    expect((await depo.stok(e.id)).get(barkod)![0]!.miktar).toBe(1);
    expect(await new PgBelgeDeposu(havuz, 'emanet').al(e.id, 'E1')).toEqual({ id: 'E1', durum: 'acik' });
    await expect(depo.islem(e.id, [barkod], () => ({ sonuc: null, hareketler: [h('emanet', 1)] }))).rejects.toThrow();
  });
});
