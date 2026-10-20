import { describe, expect, it } from 'vitest';
import { ornekEk4a, ornekReceteler, varsayilanAyarlar, type IlacKurali } from '@scalpiq/sut-motoru';
import { BellekDenetimDeposu } from '../src/denetim.js';
import { BellekKuralDeposu } from '../src/kural-deposu.js';
import { SahteMedula } from '../src/medula.js';
import { uygulamaOlustur } from '../src/uygulama.js';

function kur(kurallar: IlacKurali[] = []) {
  return uygulamaOlustur({
    ek4a: ornekEk4a,
    kurallar: new BellekKuralDeposu(kurallar),
    ayarlar: varsayilanAyarlar,
    medula: new SahteMedula(),
    denetim: new BellekDenetimDeposu(),
    bugun: () => '2026-10-20',
  });
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
    const app = kur();
    expect((await app.inject({ method: 'POST', url: '/api/kurallar', payload: kural() })).statusCode).toBe(201);

    const once = (await app.inject({ method: 'POST', url: '/api/kontrol', payload: { recete: yesilRecete() } })).json();
    expect(once.bulgular.map((b: { kuralId: string }) => b.kuralId)).toEqual(['KURAL_TANIMSIZ']);

    const onay = await app.inject({ method: 'POST', url: '/api/kurallar/GERCEK-1/onayla', payload: { onaylayan: 'Ecz. Serkan Kaya' } });
    expect(onay.json().onay).toEqual({ onaylayan: 'Ecz. Serkan Kaya', tarih: '2026-10-20' });

    const sonra = (await app.inject({ method: 'POST', url: '/api/kontrol', payload: { recete: yesilRecete() } })).json();
    expect(sonra.durum).toBe('yesil');
  });

  it('istekle gelen onay alanını yok sayar', async () => {
    const app = kur();
    await app.inject({ method: 'POST', url: '/api/kurallar', payload: { ...kural(), onay: { onaylayan: 'sahte', tarih: '2026-01-01' } } });
    const [k] = (await app.inject({ method: 'GET', url: '/api/kurallar' })).json();
    expect(k.onay).toBeUndefined();
  });

  it('geçersiz kuralı hatalarıyla reddeder', async () => {
    const r = await kur().inject({ method: 'POST', url: '/api/kurallar', payload: kural({ etkenMadde: '' }) });
    expect(r.statusCode).toBe(400);
    expect(r.json().hatalar).toContain('Etken madde boş olamaz');
  });

  it('çakışan kuralın onayını engeller; eskisi kapatılınca izin verir', async () => {
    const eski = kural({ id: 'ESKI', onay: { onaylayan: 'Ecz. A', tarih: '2026-01-01' } });
    const app = kur([eski]);
    await app.inject({ method: 'POST', url: '/api/kurallar', payload: kural({ id: 'YENI', gecerlilik: { baslangic: '2026-10-21' } }) });

    const engel = await app.inject({ method: 'POST', url: '/api/kurallar/YENI/onayla', payload: { onaylayan: 'Ecz. B' } });
    expect(engel.statusCode).toBe(409);

    const kapat = await app.inject({ method: 'POST', url: '/api/kurallar/ESKI/kapat', payload: { bitis: '2026-10-20' } });
    expect(kapat.statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/kurallar/YENI/onayla', payload: { onaylayan: 'Ecz. B' } })).statusCode).toBe(200);
  });

  it('onaylı kural silinemez, bitişi geçmişe çekilemez', async () => {
    const app = kur([kural({ onay: { onaylayan: 'Ecz. A', tarih: '2026-01-01' } })]);
    expect((await app.inject({ method: 'DELETE', url: '/api/kurallar/GERCEK-1' })).statusCode).toBe(409);
    expect((await app.inject({ method: 'POST', url: '/api/kurallar/GERCEK-1/kapat', payload: { bitis: '2026-05-01' } })).statusCode).toBe(400);
  });

  it('taslak kural silinebilir', async () => {
    const app = kur([kural()]);
    expect((await app.inject({ method: 'DELETE', url: '/api/kurallar/GERCEK-1' })).statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: '/api/kurallar' })).json()).toEqual([]);
  });
});
