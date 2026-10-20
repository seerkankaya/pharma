import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { belirtecOzeti, type HesapDeposu, type OturumKullanicisi } from './hesap.js';

declare module 'fastify' {
  interface FastifyRequest {
    kullanici?: OturumKullanicisi;
  }
}

export const CEREZ_ADI = 'scalpiq_oturum';
export const OTURUM_SURESI_SN = 12 * 60 * 60;

/** Oturum açmadan erişilebilen yollar. */
const ACIK_YOLLAR = new Set(['/api/giris']);

export function cerezOku(req: FastifyRequest): string | undefined {
  for (const parca of (req.headers.cookie ?? '').split(';')) {
    const [ad, ...deger] = parca.trim().split('=');
    if (ad === CEREZ_ADI) return decodeURIComponent(deger.join('='));
  }
  return undefined;
}

/**
 * Oturum çerezi. HttpOnly: sayfadaki betikler okuyamaz. SameSite=Strict: başka siteden gelen
 * istekle gönderilmez, bu da kontrol ve gönderim isteklerini başka sitelerin tetiklemesini engeller.
 */
export function cerezYaz(reply: FastifyReply, belirtec: string, guvenli: boolean, sureSn = OTURUM_SURESI_SN) {
  const parcalar = [`${CEREZ_ADI}=${encodeURIComponent(belirtec)}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${sureSn}`];
  if (guvenli) parcalar.push('Secure');
  reply.header('set-cookie', parcalar.join('; '));
}

/** /api altındaki her istekte oturumu doğrular; oturum yoksa 401 döner. */
export function oturumDenetimi(app: FastifyInstance, hesaplar: HesapDeposu) {
  app.addHook('onRequest', async (req, reply) => {
    const yol = req.url.split('?')[0]!;
    if (!yol.startsWith('/api/') || ACIK_YOLLAR.has(yol)) return;
    const belirtec = cerezOku(req);
    const kullanici = belirtec ? await hesaplar.oturumBul(belirtecOzeti(belirtec), new Date()) : undefined;
    if (!kullanici) return reply.code(401).send({ hata: 'Oturum açın' });
    req.kullanici = kullanici;
  });
}

export async function eczaciGerekli(req: FastifyRequest, reply: FastifyReply) {
  if (req.kullanici?.rol !== 'eczaci') return reply.code(403).send({ hata: 'Bu işlem için eczacı yetkisi gerekir' });
}

export async function kuralYetkisiGerekli(req: FastifyRequest, reply: FastifyReply) {
  if (!req.kullanici?.kuralYetkisi) return reply.code(403).send({ hata: 'Kural kitaplığını yalnızca kural yetkisi olan eczacılar değiştirebilir' });
}
