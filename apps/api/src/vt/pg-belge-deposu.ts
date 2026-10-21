import type { Belge, BelgeDeposu, BelgeDeposuUretici, BelgeYazimi } from '../belge-deposu.js';
import { islemIcinde, type Havuz } from './baglanti.js';

// Tablo yapısı her modülde aynıdır: (eczane_id, id, veri jsonb, guncelleme). Göçler tabloyu açar.
const TABLO = /^[a-z_]+$/;

/** Belgeleri verilen işlem içinde yazar; aynı kimlikli belge varsa yerine yazılır. */
export async function pgBelgeYaz(c: { query: Havuz['query'] }, tablo: string, eczaneId: string, belgeler: Belge[]) {
  if (!TABLO.test(tablo)) throw new Error(`Geçersiz tablo adı: ${tablo}`);
  // Aynı belge iki kez yazılırsa sonuncusu geçerlidir.
  const tekil = [...new Map(belgeler.map((b) => [b.id, b])).values()];
  if (!tekil.length) return;
  await c.query(
    `insert into ${tablo} (eczane_id, id, veri)
     select $1, x.id, x.veri::jsonb from unnest($2::text[], $3::text[]) as x(id, veri)
     on conflict (eczane_id, id) do update set veri = excluded.veri, guncelleme = now()`,
    [eczaneId, tekil.map((b) => b.id), tekil.map((b) => JSON.stringify(b))],
  );
}

export class PgBelgeDeposu<T extends Belge> implements BelgeDeposu<T> {
  constructor(
    private readonly havuz: Havuz,
    private readonly tablo: string,
  ) {
    if (!TABLO.test(tablo)) throw new Error(`Geçersiz tablo adı: ${tablo}`);
  }

  async liste(eczaneId: string) {
    const { rows } = await this.havuz.query<{ veri: T }>(`select veri from ${this.tablo} where eczane_id = $1 order by guncelleme desc, id`, [eczaneId]);
    return rows.map((r) => r.veri);
  }

  async al(eczaneId: string, id: string) {
    const { rows } = await this.havuz.query<{ veri: T }>(`select veri from ${this.tablo} where eczane_id = $1 and id = $2`, [eczaneId, id]);
    return rows[0]?.veri;
  }

  degistir<S>(eczaneId: string, idler: string[], f: (mevcut: Map<string, T>) => BelgeYazimi<S, T>): Promise<S> {
    return islemIcinde(this.havuz, async (c) => {
      await c.query('select pg_advisory_xact_lock(hashtext($1))', [`${this.tablo}:${eczaneId}`]);
      const { rows } = await c.query<{ id: string; veri: T }>(`select id, veri from ${this.tablo} where eczane_id = $1 and id = any($2::text[])`, [
        eczaneId,
        idler,
      ]);
      const { sonuc, yaz = [] } = f(new Map(rows.map((r) => [r.id, r.veri])));
      await pgBelgeYaz(c, this.tablo, eczaneId, yaz);
      return sonuc;
    });
  }
}

export const pgBelgeDepolari =
  (havuz: Havuz): BelgeDeposuUretici =>
  <T extends Belge>(tablo: string) =>
    new PgBelgeDeposu<T>(havuz, tablo);
