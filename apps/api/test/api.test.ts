import { describe, expect, it } from 'vitest';
import { ornekGecmis, ornekIlacKurallari, ornekReceteler, type Recete } from '@scalpiq/sut-motoru';
import { girisYap, kur as ortamKur } from './yardimci.js';

async function kur() {
  const o = await ortamKur(ornekIlacKurallari);
  const istek = await girisYap(o.app, o.kullanicilar.calisan.eposta);
  const denetim = { listele: () => o.kontroller.denetimKayitlari(o.eczaneler.kaya.id) };
  return { ...o, istek, denetim };
}

const recete = (no: string): Recete => structuredClone(ornekReceteler.find((o) => o.recete.no === no)!.recete);

describe('API', () => {
  it('yeşil reçeteyi Medula’ya gönderir ve denetim kaydı yazar', async () => {
    const { istek, medula, denetim } = await kur();
    const k = (await istek('POST', '/api/kontrol', { recete: recete('E-1001') })).json();
    expect(k.durum).toBe('yesil');

    const g = await istek('POST', '/api/gonder', { kontrolId: k.kontrolId });
    expect(g.statusCode).toBe(200);
    expect(medula.gonderilenler).toHaveLength(1);
    expect((await denetim.listele())[0]).toMatchObject({ receteNo: 'E-1001', durum: 'yesil' });

    const tekrar = await istek('POST', '/api/gonder', { kontrolId: k.kontrolId });
    expect(tekrar.statusCode).toBe(409);
  });

  it('kırmızı reçetenin gönderimini kilitler', async () => {
    const { istek, medula } = await kur();
    const k = (await istek('POST', '/api/kontrol', { recete: recete('E-1002') })).json();
    const g = await istek('POST', '/api/gonder', { kontrolId: k.kontrolId });
    expect(g.statusCode).toBe(409);
    expect(g.json().engeller.length).toBeGreaterThan(0);
    expect(medula.gonderilenler).toHaveLength(0);
  });

  it('sarı reçete gerekçelerle gönderilir ve gerekçeler kayda geçer', async () => {
    const { istek, denetim } = await kur();
    const k = (
      await istek('POST', '/api/kontrol', { recete: recete('E-1004'), gecmis: ornekGecmis['E-1004'] })
    ).json();
    expect(k.durum).toBe('sari');

    const kilitli = await istek('POST', '/api/gonder', { kontrolId: k.kontrolId });
    expect(kilitli.statusCode).toBe(409);

    const gerekceler = Object.fromEntries(
      k.bulgular.map((b: { kuralId: string; barkod?: string }) => [`${b.kuralId}:${b.barkod}`, 'Hasta ilacını kaybetti, tutanak alındı.']),
    );
    const g = await istek('POST', '/api/gonder', { kontrolId: k.kontrolId, gerekceler });
    expect(g.statusCode).toBe(200);
    expect(Object.keys((await denetim.listele())[0]!.gerekceler)).toHaveLength(2);
  });

  it('bilinmeyen kontrol kimliğini reddeder', async () => {
    const { istek } = await kur();
    const g = await istek('POST', '/api/gonder', { kontrolId: 'yok' });
    expect(g.statusCode).toBe(404);
  });

  it('bozuk reçeteyi reddeder', async () => {
    const { istek } = await kur();
    const r = await istek('POST', '/api/kontrol', { recete: { no: 'X' } });
    expect(r.statusCode).toBe(400);
  });
});
