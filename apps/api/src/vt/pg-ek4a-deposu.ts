import type { Ek4aDeposu, Ek4aSatiri, Ek4aSurumu } from '../ek4a/ek4a.js';
import { islemIcinde, type Havuz } from './baglanti.js';

const SURUM_ALANLARI = `id, to_char(yayim_tarihi, 'YYYY-MM-DD') as "yayimTarihi", dosya_adi as "dosyaAdi", yukleyen,
  zaman, kayit_sayisi as "kayitSayisi"`;

type SurumSatiri = Omit<Ek4aSurumu, 'zaman' | 'dosyaAdi'> & { zaman: Date; dosyaAdi: string | null };

const surumYap = ({ zaman, dosyaAdi, ...s }: SurumSatiri): Ek4aSurumu => ({
  ...s,
  zaman: new Date(zaman).toISOString(),
  ...(dosyaAdi ? { dosyaAdi } : {}),
});

/** Tek sorguda en çok bu kadar satır yazılır (PostgreSQL parametre sınırının altında kalmak için). */
const PARCA = 2000;

export class PgEk4aDeposu implements Ek4aDeposu {
  constructor(private readonly havuz: Havuz) {}

  async aktif() {
    const { rows } = await this.havuz.query<SurumSatiri>(`select ${SURUM_ALANLARI} from ek4a_surum order by yayim_tarihi desc, zaman desc limit 1`);
    if (!rows[0]) return undefined;
    const surum = surumYap(rows[0]);
    const k = await this.havuz.query<{
      barkod: string;
      ad: string;
      kamuNo: string | null;
      esdegerGrubu: string | null;
      eskiBarkodlar: string[];
      pasifAraliklari: Ek4aSatiri['pasifAraliklari'] | null;
    }>(
      `select barkod, ad, kamu_no as "kamuNo", esdeger_grubu as "esdegerGrubu", eski_barkodlar as "eskiBarkodlar",
              pasif_araliklari as "pasifAraliklari"
         from ek4a_kaydi where surum_id = $1 order by ad`,
      [surum.id],
    );
    const kayitlar: Ek4aSatiri[] = k.rows.map(({ kamuNo, esdegerGrubu, pasifAraliklari, ...r }) => ({
      ...r,
      ...(kamuNo ? { kamuNo } : {}),
      ...(esdegerGrubu ? { esdegerGrubu } : {}),
      ...(pasifAraliklari?.length ? { pasifAraliklari } : {}),
    }));
    return { surum, kayitlar };
  }

  ekle(s: Omit<Ek4aSurumu, 'id' | 'zaman' | 'kayitSayisi'> & { kullaniciId: string }, kayitlar: Ek4aSatiri[]) {
    return islemIcinde(this.havuz, async (c) => {
      const { rows } = await c.query<SurumSatiri>(
        `insert into ek4a_surum (yayim_tarihi, dosya_adi, yukleyen, kullanici_id, kayit_sayisi) values ($1, $2, $3, $4, $5)
         returning ${SURUM_ALANLARI}`,
        [s.yayimTarihi, s.dosyaAdi ?? null, s.yukleyen, s.kullaniciId, kayitlar.length],
      );
      const surum = surumYap(rows[0]!);
      for (let i = 0; i < kayitlar.length; i += PARCA) {
        const parca = kayitlar.slice(i, i + PARCA);
        await c.query(
          `insert into ek4a_kaydi (surum_id, barkod, ad, kamu_no, esdeger_grubu, eski_barkodlar, pasif_araliklari)
           select $1, t.barkod, t.ad, t.kamu_no, t.esdeger_grubu, coalesce(string_to_array(nullif(t.eski, ''), ','), '{}'), t.pasif::jsonb
             from unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[])
               as t(barkod, ad, kamu_no, esdeger_grubu, eski, pasif)`,
          [
            surum.id,
            parca.map((k) => k.barkod),
            parca.map((k) => k.ad),
            parca.map((k) => k.kamuNo ?? null),
            parca.map((k) => k.esdegerGrubu ?? null),
            parca.map((k) => k.eskiBarkodlar.join(',')),
            parca.map((k) => (k.pasifAraliklari?.length ? JSON.stringify(k.pasifAraliklari) : null)),
          ],
        );
      }
      return surum;
    });
  }

  async surumler() {
    const { rows } = await this.havuz.query<SurumSatiri>(`select ${SURUM_ALANLARI} from ek4a_surum order by yayim_tarihi desc, zaman desc limit 100`);
    return rows.map(surumYap);
  }
}
