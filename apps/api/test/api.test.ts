import { describe, expect, it } from 'vitest';
import { ornekEk4a, ornekGecmis, ornekIlacKurallari, ornekReceteler, varsayilanAyarlar, type Recete } from '@scalpiq/sut-motoru';
import { BellekDenetimDeposu } from '../src/denetim.js';
import { BellekKuralDeposu } from '../src/kural-deposu.js';
import { SahteMedula } from '../src/medula.js';
import { uygulamaOlustur } from '../src/uygulama.js';

function kur() {
  const medula = new SahteMedula();
  const denetim = new BellekDenetimDeposu();
  const app = uygulamaOlustur({
    ek4a: ornekEk4a,
    kurallar: new BellekKuralDeposu(ornekIlacKurallari),
    ayarlar: varsayilanAyarlar,
    medula,
    denetim,
    bugun: () => '2026-10-20',
  });
  return { app, medula, denetim };
}

const recete = (no: string): Recete => structuredClone(ornekReceteler.find((o) => o.recete.no === no)!.recete);

describe('API', () => {
  it('yeşil reçeteyi Medula’ya gönderir ve denetim kaydı yazar', async () => {
    const { app, medula, denetim } = kur();
    const k = (await app.inject({ method: 'POST', url: '/api/kontrol', payload: { recete: recete('E-1001') } })).json();
    expect(k.durum).toBe('yesil');

    const g = await app.inject({ method: 'POST', url: '/api/gonder', payload: { kontrolId: k.kontrolId } });
    expect(g.statusCode).toBe(200);
    expect(medula.gonderilenler).toHaveLength(1);
    expect((await denetim.listele())[0]).toMatchObject({ receteNo: 'E-1001', durum: 'yesil' });

    const tekrar = await app.inject({ method: 'POST', url: '/api/gonder', payload: { kontrolId: k.kontrolId } });
    expect(tekrar.statusCode).toBe(409);
  });

  it('kırmızı reçetenin gönderimini kilitler', async () => {
    const { app, medula } = kur();
    const k = (await app.inject({ method: 'POST', url: '/api/kontrol', payload: { recete: recete('E-1002') } })).json();
    const g = await app.inject({ method: 'POST', url: '/api/gonder', payload: { kontrolId: k.kontrolId } });
    expect(g.statusCode).toBe(409);
    expect(g.json().engeller.length).toBeGreaterThan(0);
    expect(medula.gonderilenler).toHaveLength(0);
  });

  it('sarı reçete gerekçelerle gönderilir ve gerekçeler kayda geçer', async () => {
    const { app, denetim } = kur();
    const k = (
      await app.inject({ method: 'POST', url: '/api/kontrol', payload: { recete: recete('E-1004'), gecmis: ornekGecmis['E-1004'] } })
    ).json();
    expect(k.durum).toBe('sari');

    const kilitli = await app.inject({ method: 'POST', url: '/api/gonder', payload: { kontrolId: k.kontrolId } });
    expect(kilitli.statusCode).toBe(409);

    const gerekceler = Object.fromEntries(
      k.bulgular.map((b: { kuralId: string; barkod?: string }) => [`${b.kuralId}:${b.barkod}`, 'Hasta ilacını kaybetti, tutanak alındı.']),
    );
    const g = await app.inject({ method: 'POST', url: '/api/gonder', payload: { kontrolId: k.kontrolId, gerekceler } });
    expect(g.statusCode).toBe(200);
    expect(Object.keys((await denetim.listele())[0]!.gerekceler)).toHaveLength(2);
  });

  it('bilinmeyen kontrol kimliğini reddeder', async () => {
    const { app } = kur();
    const g = await app.inject({ method: 'POST', url: '/api/gonder', payload: { kontrolId: 'yok' } });
    expect(g.statusCode).toBe(404);
  });

  it('bozuk reçeteyi reddeder', async () => {
    const { app } = kur();
    const r = await app.inject({ method: 'POST', url: '/api/kontrol', payload: { recete: { no: 'X' } } });
    expect(r.statusCode).toBe(400);
  });
});
