import { partiler, type Parti, type Satis, type StokHareketi, type Urun } from '../stok/stok.js';
import type { AlisFaturasi, Tedarikci } from '../alis/alis.js';
import { FaturaZatenVarHatasi, type StokDeposu, type StokYazimi } from '../stok/stok-deposu.js';
import { pgBelgeYaz } from './pg-belge-deposu.js';
import { islemIcinde, type Havuz } from './baglanti.js';
import { pgBorcYaz } from './pg-cari-deposu.js';

const HAREKET_ALANLARI = `parti_no as "partiNo", to_char(skt, 'YYYY-MM-DD') as skt, miktar`;

function haritala(satirlar: (Parti & { barkod: string })[]) {
  const m = new Map<string, Parti[]>();
  for (const b of new Set(satirlar.map((s) => s.barkod))) m.set(b, partiler(satirlar.filter((s) => s.barkod === b)));
  return m;
}

export class PgStokDeposu implements StokDeposu {
  constructor(private readonly havuz: Havuz) {}

  async urunler(eczaneId: string) {
    const { rows } = await this.havuz.query<{ veri: Urun }>('select veri from urun where eczane_id = $1 order by veri ->> \'ad\'', [eczaneId]);
    return rows.map((r) => r.veri);
  }

  async urunKaydet(eczaneId: string, urun: Urun) {
    await this.havuz.query(
      `insert into urun (eczane_id, barkod, veri) values ($1, $2, $3)
       on conflict (eczane_id, barkod) do update set veri = excluded.veri, guncelleme = now()`,
      [eczaneId, urun.barkod, JSON.stringify(urun)],
    );
  }

  async stok(eczaneId: string) {
    const { rows } = await this.havuz.query<Parti & { barkod: string }>(
      `select barkod, ${HAREKET_ALANLARI} from stok_hareketi where eczane_id = $1`,
      [eczaneId],
    );
    return haritala(rows);
  }

  islem<T>(eczaneId: string, barkodlar: string[], f: (partiler: Map<string, Parti[]>) => StokYazimi<T>): Promise<T> {
    return islemIcinde(this.havuz, async (c) => {
      // Ürün başına kilit; sıralı alınır ki iki işlem birbirini beklerken kilitlenmesin.
      for (const b of [...new Set(barkodlar)].sort())
        await c.query('select pg_advisory_xact_lock(hashtext($1))', [`stok:${eczaneId}:${b}`]);
      const { rows } = await c.query<Parti & { barkod: string }>(
        `select barkod, ${HAREKET_ALANLARI} from stok_hareketi where eczane_id = $1 and barkod = any($2)`,
        [eczaneId, barkodlar],
      );
      const y = f(haritala(rows));
      for (const u of y.yeniUrunler ?? [])
        await c.query('insert into urun (eczane_id, barkod, veri) values ($1, $2, $3) on conflict do nothing', [eczaneId, u.barkod, JSON.stringify(u)]);
      if (y.fatura) {
        try {
          await c.query('insert into alis_faturasi (id, eczane_id, tedarikci_id, fatura_no, zaman, veri) values ($1, $2, $3, $4, $5, $6)', [
            y.fatura.id,
            eczaneId,
            y.fatura.tedarikciId,
            y.fatura.faturaNo,
            y.fatura.zaman,
            JSON.stringify(y.fatura),
          ]);
        } catch (e) {
          if ((e as { code?: string }).code === '23505') throw new FaturaZatenVarHatasi(y.fatura.faturaNo);
          throw e;
        }
      }
      if (y.satis)
        await c.query('insert into satis (id, eczane_id, kullanici_id, zaman, veri) values ($1, $2, $3, $4, $5)', [
          y.satis.id,
          eczaneId,
          y.satis.kullaniciId,
          y.satis.zaman,
          JSON.stringify(y.satis),
        ]);
      for (const h of y.hareketler ?? []) await this.hareketYaz(c, eczaneId, h);
      for (const { tablo, belge } of y.belgeler ?? []) await pgBelgeYaz(c, tablo, eczaneId, [belge]);
      // Satış satırı önce yazılmalı: borç hareketi satışa bağlanır.
      if (y.cariBorc) await pgBorcYaz(c, eczaneId, y.cariBorc);
      return y.sonuc;
    });
  }

  private hareketYaz(c: { query: Havuz['query'] }, eczaneId: string, h: StokHareketi) {
    return c.query(
      `insert into stok_hareketi (eczane_id, barkod, tur, miktar, parti_no, skt, birim_maliyet_kurus, satis_id, fatura_id, aciklama, kullanici_id, zaman)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [eczaneId, h.barkod, h.tur, h.miktar, h.partiNo, h.skt, h.birimMaliyetKurus ?? null, h.satisId ?? null, h.faturaId ?? null, h.aciklama ?? null, h.kullaniciId, h.zaman],
    );
  }

  async girisler(eczaneId: string) {
    const { rows } = await this.havuz.query<StokHareketi>(
      `select barkod, 'giris' as tur, ${HAREKET_ALANLARI}, birim_maliyet_kurus as "birimMaliyetKurus", kullanici_id as "kullaniciId",
              to_char(zaman at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as zaman
         from stok_hareketi where eczane_id = $1 and tur = 'giris'`,
      [eczaneId],
    );
    return rows.map(({ birimMaliyetKurus, ...h }) => (birimMaliyetKurus === null ? h : { ...h, birimMaliyetKurus }));
  }

  async satislar(eczaneId: string, baslangic: Date, bitis: Date) {
    const { rows } = await this.havuz.query<{ veri: Satis }>(
      'select veri from satis where eczane_id = $1 and zaman >= $2 and zaman < $3 order by zaman desc',
      [eczaneId, baslangic, bitis],
    );
    return rows.map((r) => r.veri);
  }

  async tedarikciler(eczaneId: string) {
    const { rows } = await this.havuz.query<Tedarikci>(
      `select id, ad, vergi_no as "vergiNo", telefon from tedarikci where eczane_id = $1 order by ad`,
      [eczaneId],
    );
    return rows.map((t) => ({ id: t.id, ad: t.ad, ...(t.vergiNo ? { vergiNo: t.vergiNo } : {}), ...(t.telefon ? { telefon: t.telefon } : {}) }));
  }

  async tedarikciEkle(eczaneId: string, t: Omit<Tedarikci, 'id'>) {
    const { rows } = await this.havuz.query<{ id: string }>(
      'insert into tedarikci (eczane_id, ad, vergi_no, telefon) values ($1, $2, $3, $4) returning id',
      [eczaneId, t.ad, t.vergiNo ?? null, t.telefon ?? null],
    );
    return { ...t, id: rows[0]!.id };
  }

  async faturalar(eczaneId: string) {
    const { rows } = await this.havuz.query<{ veri: AlisFaturasi }>(
      'select veri from alis_faturasi where eczane_id = $1 order by zaman desc limit 500',
      [eczaneId],
    );
    return rows.map((r) => r.veri);
  }
}
