import { bakiye, CariHatasi, limitDenetle, type CariBorc, type CariDeposu, type CariHareket, type Musteri } from '../cari/cari.js';
import { islemIcinde, type Havuz } from './baglanti.js';

type Sorgulayici = { query: Havuz['query'] };

const HAREKET_ALANLARI = `musteri_id as "musteriId", tur, tutar_kurus as "tutarKurus", satis_id as "satisId", odeme_turu as "odemeTuru",
  aciklama, kullanici_id as "kullaniciId", kaydeden, zaman`;

const temizle = <T extends object>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null)) as T;

async function kilitliBakiye(c: Sorgulayici, eczaneId: string, musteriId: string) {
  await c.query('select pg_advisory_xact_lock(hashtext($1))', [`cari:${eczaneId}:${musteriId}`]);
  const { rows } = await c.query<Pick<CariHareket, 'tur' | 'tutarKurus'>>(
    'select tur, tutar_kurus as "tutarKurus" from cari_hareket where eczane_id = $1 and musteri_id = $2',
    [eczaneId, musteriId],
  );
  return bakiye(rows);
}

async function hareketYaz(c: Sorgulayici, eczaneId: string, h: CariHareket) {
  await c.query(
    `insert into cari_hareket (eczane_id, musteri_id, tur, tutar_kurus, satis_id, odeme_turu, aciklama, kullanici_id, kaydeden, zaman)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [eczaneId, h.musteriId, h.tur, h.tutarKurus, h.satisId ?? null, h.odemeTuru ?? null, h.aciklama ?? null, h.kullaniciId, h.kaydeden, h.zaman],
  );
}

/** Stok deposunun satış işlemi içinden çağrılır: limit denetimi ve borç aynı işlemde. */
export async function pgBorcYaz(c: Sorgulayici, eczaneId: string, borc: CariBorc) {
  limitDenetle(await kilitliBakiye(c, eczaneId, borc.hareket.musteriId), borc);
  await hareketYaz(c, eczaneId, borc.hareket);
}

export class PgCariDeposu implements CariDeposu {
  constructor(private readonly havuz: Havuz) {}

  async musteriler(eczaneId: string) {
    const { rows } = await this.havuz.query<Musteri & { bakiyeKurus: number }>(
      `select m.id, m.ad_soyad as "adSoyad", m.telefon, m.limit_kurus as "limitKurus", m."not",
              coalesce(sum(case h.tur when 'borc' then h.tutar_kurus else -h.tutar_kurus end), 0)::int as "bakiyeKurus"
         from musteri m left join cari_hareket h on h.musteri_id = m.id
        where m.eczane_id = $1
        group by m.id order by m.ad_soyad`,
      [eczaneId],
    );
    return rows.map(temizle);
  }

  async musteriAl(eczaneId: string, id: string) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return undefined;
    const { rows } = await this.havuz.query<Musteri>(
      `select id, ad_soyad as "adSoyad", telefon, limit_kurus as "limitKurus", "not" from musteri where eczane_id = $1 and id = $2`,
      [eczaneId, id],
    );
    return rows[0] && temizle(rows[0]);
  }

  async musteriEkle(eczaneId: string, m: Omit<Musteri, 'id'>) {
    const { rows } = await this.havuz.query<{ id: string }>(
      'insert into musteri (eczane_id, ad_soyad, telefon, limit_kurus, "not") values ($1, $2, $3, $4, $5) returning id',
      [eczaneId, m.adSoyad, m.telefon ?? null, m.limitKurus ?? null, m.not ?? null],
    );
    return { ...m, id: rows[0]!.id };
  }

  async hareketler(eczaneId: string, musteriId: string) {
    const { rows } = await this.havuz.query<CariHareket & { zaman: Date }>(
      `select ${HAREKET_ALANLARI} from cari_hareket where eczane_id = $1 and musteri_id = $2 order by sira desc`,
      [eczaneId, musteriId],
    );
    return rows.map((r) => temizle({ ...r, zaman: new Date(r.zaman).toISOString() }));
  }

  tahsilat(eczaneId: string, h: CariHareket) {
    return islemIcinde(this.havuz, async (c) => {
      const once = await kilitliBakiye(c, eczaneId, h.musteriId);
      if (h.tutarKurus > once) throw new CariHatasi(`Tahsilat borçtan fazla olamaz (borç ${(once / 100).toFixed(2)} TL)`);
      await hareketYaz(c, eczaneId, h);
      return once - h.tutarKurus;
    });
  }
}
