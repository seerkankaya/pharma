import { readdir, readFile } from 'node:fs/promises';
import pg from 'pg';

export type Havuz = pg.Pool;

export function havuzOlustur(baglantiAdresi: string): Havuz {
  return new pg.Pool({ connectionString: baglantiAdresi, max: 10 });
}

const GOC_KLASORU = new URL('./gocler/', import.meta.url);

/**
 * gocler/ klasöründeki SQL dosyalarını ad sırasıyla, her biri bir kez olmak üzere uygular.
 * Uygulanmış bir dosya sonradan değiştirilmez; değişiklik için yeni dosya eklenir.
 * Birden çok sunucu aynı anda açılırsa danışma kilidi yalnızca birinin uygulamasını sağlar.
 */
export async function gocleriUygula(havuz: Havuz): Promise<string[]> {
  const dosyalar = (await readdir(GOC_KLASORU)).filter((d) => d.endsWith('.sql')).sort();
  const istemci = await havuz.connect();
  try {
    await istemci.query('begin');
    await istemci.query("select pg_advisory_xact_lock(hashtext('scalpiq_goc'))");
    await istemci.query('create table if not exists goc (ad text primary key, zaman timestamptz not null default now())');
    const { rows } = await istemci.query<{ ad: string }>('select ad from goc');
    const uygulanmis = new Set(rows.map((r) => r.ad));
    const yeni = dosyalar.filter((d) => !uygulanmis.has(d));
    for (const d of yeni) {
      await istemci.query(await readFile(new URL(d, GOC_KLASORU), 'utf8'));
      await istemci.query('insert into goc (ad) values ($1)', [d]);
    }
    await istemci.query('commit');
    return yeni;
  } catch (e) {
    await istemci.query('rollback');
    throw e;
  } finally {
    istemci.release();
  }
}

/** İşlemi tek bir veritabanı işlemi (transaction) içinde yürütür. */
export async function islemIcinde<T>(havuz: Havuz, f: (istemci: pg.PoolClient) => Promise<T>): Promise<T> {
  const istemci = await havuz.connect();
  try {
    await istemci.query('begin');
    const sonuc = await f(istemci);
    await istemci.query('commit');
    return sonuc;
  } catch (e) {
    await istemci.query('rollback');
    throw e;
  } finally {
    istemci.release();
  }
}
