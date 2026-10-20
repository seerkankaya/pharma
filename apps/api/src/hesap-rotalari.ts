import type { FastifyInstance } from 'fastify';
import {
  ASGARI_PAROLA_UZUNLUGU,
  disaAcik,
  epostaDuzelt,
  EpostaKullanimdaHatasi,
  oturumBelirteci,
  belirtecOzeti,
  parolaDogru,
  parolaOzetle,
  type HesapDeposu,
  type Rol,
} from './hesap.js';
import { cerezOku, cerezYaz, eczaciGerekli, OTURUM_SURESI_SN } from './oturum.js';

const HATALI_GIRIS_SINIRI = 5;
const KILIT_SURESI_MS = 15 * 60 * 1000;

/**
 * Aynı e-postayla art arda hatalı girişte hesabı kısa süre kilitler (parola deneme saldırısına karşı).
 * Sayaç sunucu belleğinde; birden çok sunucuya geçince ortak depoya taşınmalı.
 */
class GirisSiniri {
  private denemeler = new Map<string, { sayi: number; kilitBitis?: number }>();

  kilitli(eposta: string, simdi: number) {
    const d = this.denemeler.get(eposta);
    return !!d?.kilitBitis && d.kilitBitis > simdi;
  }

  hatali(eposta: string, simdi: number) {
    const d = this.denemeler.get(eposta) ?? { sayi: 0 };
    if (d.kilitBitis && d.kilitBitis <= simdi) d.sayi = 0;
    d.sayi += 1;
    d.kilitBitis = d.sayi >= HATALI_GIRIS_SINIRI ? simdi + KILIT_SURESI_MS : undefined;
    this.denemeler.set(eposta, d);
  }

  basarili(eposta: string) {
    this.denemeler.delete(eposta);
  }
}

// Hiç var olmayan e-postada da parola özeti hesaplanır; yanıt süresinden hesabın var olup olmadığı anlaşılmasın.
const SAHTE_OZET = parolaOzetle('sahte-parola-karsilastirma');

export function hesapRotalari(app: FastifyInstance, hesaplar: HesapDeposu, guvenliCerez: boolean) {
  const sinir = new GirisSiniri();

  app.post<{ Body: { eposta?: string; parola?: string } }>('/api/giris', async (req, reply) => {
    const eposta = epostaDuzelt(req.body?.eposta ?? '');
    const parola = req.body?.parola ?? '';
    if (!eposta || !parola) return reply.code(400).send({ hata: 'E-posta ve parola gerekli' });
    if (sinir.kilitli(eposta, Date.now()))
      return reply.code(429).send({ hata: 'Çok sayıda hatalı deneme. 15 dakika sonra yeniden deneyin.' });

    const k = await hesaplar.epostaylaBul(eposta);
    const dogru = await parolaDogru(parola, k?.parolaOzeti ?? (await SAHTE_OZET));
    if (!k || !dogru || !k.aktif) {
      sinir.hatali(eposta, Date.now());
      return reply.code(401).send({ hata: 'E-posta ya da parola hatalı' });
    }
    sinir.basarili(eposta);

    const { belirtec, ozet } = oturumBelirteci();
    await hesaplar.oturumEkle(ozet, k.id, new Date(Date.now() + OTURUM_SURESI_SN * 1000));
    cerezYaz(reply, belirtec, guvenliCerez);
    return hesaplar.oturumBul(ozet, new Date());
  });

  app.post('/api/cikis', async (req, reply) => {
    const belirtec = cerezOku(req);
    if (belirtec) await hesaplar.oturumSil(belirtecOzeti(belirtec));
    cerezYaz(reply, '', guvenliCerez, 0);
    return reply.code(204).send();
  });

  app.get('/api/ben', async (req) => req.kullanici);

  app.get('/api/kullanicilar', { preHandler: eczaciGerekli }, async (req) =>
    (await hesaplar.eczaneKullanicilari(req.kullanici!.eczaneId)).map(disaAcik),
  );

  // Eczacı yalnızca kendi eczanesine kullanıcı ekler. Kural yetkisi buradan verilmez.
  app.post<{ Body: { eposta?: string; adSoyad?: string; rol?: Rol; parola?: string } }>(
    '/api/kullanicilar',
    { preHandler: eczaciGerekli },
    async (req, reply) => {
      const { eposta = '', adSoyad = '', rol, parola = '' } = req.body ?? {};
      const hatalar: string[] = [];
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(eposta.trim())) hatalar.push('Geçerli bir e-posta girin');
      if (!adSoyad.trim()) hatalar.push('Ad soyad boş olamaz');
      if (rol !== 'eczaci' && rol !== 'calisan') hatalar.push('Rol eczacı ya da çalışan olmalı');
      if (parola.length < ASGARI_PAROLA_UZUNLUGU) hatalar.push(`Parola en az ${ASGARI_PAROLA_UZUNLUGU} karakter olmalı`);
      if (hatalar.length) return reply.code(400).send({ hata: 'Kullanıcı bilgileri geçersiz', hatalar });
      try {
        const k = await hesaplar.kullaniciEkle({
          eczaneId: req.kullanici!.eczaneId,
          eposta,
          adSoyad: adSoyad.trim(),
          rol: rol!,
          kuralYetkisi: false,
          parolaOzeti: await parolaOzetle(parola),
        });
        return reply.code(201).send(disaAcik(k));
      } catch (e) {
        if (e instanceof EpostaKullanimdaHatasi) return reply.code(409).send({ hata: e.message });
        throw e;
      }
    },
  );

  app.post<{ Params: { id: string }; Body: { aktif?: boolean } }>(
    '/api/kullanicilar/:id/durum',
    { preHandler: eczaciGerekli },
    async (req, reply) => {
      if (typeof req.body?.aktif !== 'boolean') return reply.code(400).send({ hata: 'aktif alanı gerekli' });
      if (req.params.id === req.kullanici!.id) return reply.code(409).send({ hata: 'Kendi hesabınızı kapatamazsınız' });
      const bulundu = await hesaplar.kullaniciDurumu(req.params.id, req.kullanici!.eczaneId, req.body.aktif);
      if (!bulundu) return reply.code(404).send({ hata: 'Kullanıcı bulunamadı' });
      return reply.code(204).send();
    },
  );
}
