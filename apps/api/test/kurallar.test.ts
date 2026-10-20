import { describe, expect, it } from 'vitest';
import { ornekReceteler, type IlacKurali } from '@scalpiq/sut-motoru';
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
});
