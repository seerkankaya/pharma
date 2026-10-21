import { describe, expect, it } from 'vitest';
import { ornekReceteler, SUT_SURUMU, sutTaslakKurallari, type IlacKurali } from '@scalpiq/sut-motoru';
import { girisYap, kur as ortamKur } from './yardimci.js';

/** Kural yetkili eczacı olarak oturum açılmış istemci. */
async function kur(kurallar: IlacKurali[] = []) {
  const o = await ortamKur(kurallar);
  return girisYap(o.app, o.kullanicilar.eczaci.eposta);
}

const kural = (ek: Partial<IlacKurali> = {}): IlacKurali => ({
  id: 'GERCEK-1',
  etkenMadde: 'ÖRNEKMADDE-A',
  aciklama: 'Kardiyoloji uzman raporu ile',
  kaynak: { tur: 'SUT', madde: '4.2.X', aciklama: 'SUT' },
  gecerlilik: { baslangic: '2026-01-01' },
  raporGerekli: true,
  raporDuzenleyenBranslar: ['Kardiyoloji'],
  ...ek,
});

const yesilRecete = () => structuredClone(ornekReceteler[0]!.recete);

describe('kural kitaplığı', () => {
  it('taslak kural kontrolde kullanılmaz, onaylanınca kullanılır', async () => {
    const app = await kur();
    expect((await app('POST', '/api/kurallar', kural())).statusCode).toBe(201);

    const once = (await app('POST', '/api/kontrol', { recete: yesilRecete() })).json();
    expect(once.bulgular.map((b: { kuralId: string }) => b.kuralId)).toEqual(['KURAL_TANIMSIZ']);

    const onay = await app('POST', '/api/kurallar/GERCEK-1/onayla');
    expect(onay.json().onay).toEqual({ onaylayan: 'Ecz. Serkan Kaya', tarih: '2026-10-20' });

    const sonra = (await app('POST', '/api/kontrol', { recete: yesilRecete() })).json();
    expect(sonra.durum).toBe('yesil');
  });

  it('istekle gelen onay alanını yok sayar', async () => {
    const app = await kur();
    await app('POST', '/api/kurallar', { ...kural(), onay: { onaylayan: 'sahte', tarih: '2026-01-01' } });
    const [k] = (await app('GET', '/api/kurallar')).json();
    expect(k.onay).toBeUndefined();
  });

  it('geçersiz kuralı hatalarıyla reddeder', async () => {
    const r = await (await kur())('POST', '/api/kurallar', kural({ etkenMadde: '' }));
    expect(r.statusCode).toBe(400);
    expect(r.json().hatalar).toContain('Etken madde boş olamaz');
  });

  it('çakışan kuralın onayını engeller; eskisi kapatılınca izin verir', async () => {
    const eski = kural({ id: 'ESKI', onay: { onaylayan: 'Ecz. A', tarih: '2026-01-01' } });
    const app = await kur([eski]);
    await app('POST', '/api/kurallar', kural({ id: 'YENI', gecerlilik: { baslangic: '2026-10-21' } }));

    const engel = await app('POST', '/api/kurallar/YENI/onayla');
    expect(engel.statusCode).toBe(409);

    const kapat = await app('POST', '/api/kurallar/ESKI/kapat', { bitis: '2026-10-20' });
    expect(kapat.statusCode).toBe(200);
    expect((await app('POST', '/api/kurallar/YENI/onayla')).statusCode).toBe(200);
  });

  it('onaylı kural silinemez, bitişi geçmişe çekilemez', async () => {
    const app = await kur([kural({ onay: { onaylayan: 'Ecz. A', tarih: '2026-01-01' } })]);
    expect((await app('DELETE', '/api/kurallar/GERCEK-1')).statusCode).toBe(409);
    expect((await app('POST', '/api/kurallar/GERCEK-1/kapat', { bitis: '2026-05-01' })).statusCode).toBe(400);
  });

  it('taslak kural silinebilir', async () => {
    const app = await kur([kural()]);
    expect((await app('DELETE', '/api/kurallar/GERCEK-1')).statusCode).toBe(204);
    expect((await app('GET', '/api/kurallar')).json()).toEqual([]);
  });

  it('taslak düzenlenir; onaylı kural düzenlenemez ve onay düzenlemeyle eklenemez', async () => {
    const app = await kur([kural(), kural({ id: 'ONAYLI', onay: { onaylayan: 'Ecz. A', tarih: '2026-01-01' } })]);
    const r = await app('PUT', '/api/kurallar/GERCEK-1', { ...kural({ aciklama: 'Düzeltildi' }), onay: { onaylayan: 'Sahte', tarih: '2026-01-01' } });
    expect(r.statusCode).toBe(200);
    const k = (await app('GET', '/api/kurallar')).json().find((x: { id: string }) => x.id === 'GERCEK-1');
    expect(k.aciklama).toBe('Düzeltildi');
    expect(k.onay).toBeUndefined();
    expect((await app('PUT', '/api/kurallar/ONAYLI', kural({ id: 'ONAYLI' }))).statusCode).toBe(409);
    expect((await app('PUT', '/api/kurallar/YOK', kural())).statusCode).toBe(404);
  });

  it('SUT taslakları bir kez eklenir, var olana dokunulmaz', async () => {
    const app = await kur();
    const once = (await app('GET', '/api/kurallar/sut-taslaklari')).json();
    expect(once.eksik).toBe(once.toplam);
    expect((await app('POST', '/api/kurallar/sut-taslaklari')).json()).toEqual({ eklenen: once.toplam, guncellenen: 0, yeniSurum: [] });
    expect((await app('POST', '/api/kurallar/sut-taslaklari')).json()).toEqual({ eklenen: 0, guncellenen: 0, yeniSurum: [] });
    const kurallar = (await app('GET', '/api/kurallar')).json();
    expect(kurallar).toHaveLength(once.toplam);
    expect(kurallar.every((k: { onay?: unknown }) => !k.onay)).toBe(true);
  });

  it('SUT metni değişince eski taslak güncellenir, onaylı kural için yeni sürüm taslağı açılır', async () => {
    const taslak = (id: string) => structuredClone(sutTaslakKurallari.find((k) => k.id === id)!);
    const eskiTaslak = { ...taslak('SUT-4.2.15.D-APIKSABAN'), aciklama: 'eski metin', raporTuru: 'saglik-kurulu' as const };
    const eskiOnayli = { ...taslak('SUT-4.2.38-SITAGLIPTIN'), aciklama: 'eski metin', onay: { onaylayan: 'Ecz. A', tarih: '2026-09-01' } };
    const ayniOnayli = { ...taslak('SUT-4.2.38-LINAGLIPTIN'), onay: { onaylayan: 'Ecz. A', tarih: '2026-09-01' } };
    const app = await kur([eskiTaslak, eskiOnayli, ayniOnayli]);

    const durum = (await app('GET', '/api/kurallar/sut-taslaklari')).json();
    expect(durum).toMatchObject({ eksik: sutTaslakKurallari.length - 3, guncellenecek: 1, yeniSurum: [`SUT-4.2.38-SITAGLIPTIN-${SUT_SURUMU}`] });
    const r = (await app('POST', '/api/kurallar/sut-taslaklari')).json();
    expect(r).toMatchObject({ guncellenen: 1, yeniSurum: [`SUT-4.2.38-SITAGLIPTIN-${SUT_SURUMU}`] });

    const kurallar: IlacKurali[] = (await app('GET', '/api/kurallar')).json();
    const bul = (id: string) => kurallar.find((k) => k.id === id)!;
    expect(bul('SUT-4.2.15.D-APIKSABAN').aciklama).toBe(taslak('SUT-4.2.15.D-APIKSABAN').aciklama);
    expect(bul('SUT-4.2.15.D-APIKSABAN').raporTuru).toBeUndefined();
    // Onaylı kural kendiliğinden değişmez.
    expect(bul('SUT-4.2.38-SITAGLIPTIN')).toEqual(eskiOnayli);
    const yeni = bul(`SUT-4.2.38-SITAGLIPTIN-${SUT_SURUMU}`);
    expect(yeni.onay).toBeUndefined();
    // Eczacı eskisini dünle kapatıp yenisini onaylar; tarihler çakışmaz.
    expect((await app('POST', `/api/kurallar/${encodeURIComponent(yeni.id)}/onayla`)).statusCode).toBe(409);
    const dun = new Date(Date.parse(`${yeni.gecerlilik.baslangic}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
    expect((await app('POST', '/api/kurallar/SUT-4.2.38-SITAGLIPTIN/kapat', { bitis: dun })).statusCode).toBe(200);
    expect((await app('POST', `/api/kurallar/${encodeURIComponent(yeni.id)}/onayla`)).statusCode).toBe(200);
    // Artık yapılacak bir şey yok.
    expect((await app('GET', '/api/kurallar/sut-taslaklari')).json()).toMatchObject({ eksik: 0, guncellenecek: 0, yeniSurum: [] });
  });

  it('SUT taslaklarını yalnızca kural yetkili eczacı ekler', async () => {
    const o = await ortamKur();
    const calisan = await girisYap(o.app, o.kullanicilar.calisan.eposta);
    expect((await calisan('POST', '/api/kurallar/sut-taslaklari')).statusCode).toBe(403);
  });
});
