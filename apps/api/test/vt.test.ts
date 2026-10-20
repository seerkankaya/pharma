import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ornekIlacKurallari, ornekReceteler, type IlacKurali, type KontrolSonucu } from '@scalpiq/sut-motoru';
import { EpostaKullanimdaHatasi } from '../src/hesap.js';
import type { DenetimKaydi } from '../src/kontrol-deposu.js';
import { gocleriUygula, havuzOlustur, type Havuz } from '../src/vt/baglanti.js';
import { PgHesapDeposu, PgKontrolDeposu, PgKuralDeposu } from '../src/vt/pg-depolar.js';

// PostgreSQL depolarının testleri. Yalnızca TEST_DATABASE_URL verildiğinde çalışır;
// veritabanındaki her şeyi siler, bu yüzden yalnızca test için açılmış bir veritabanı verin.
const adres = process.env.TEST_DATABASE_URL;

describe.skipIf(!adres)('PostgreSQL depoları', () => {
  let havuz: Havuz;

  beforeAll(async () => {
    havuz = havuzOlustur(adres!);
    await havuz.query('drop schema public cascade; create schema public;');
    expect(await gocleriUygula(havuz)).toEqual(['001_ilk.sql']);
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
});
