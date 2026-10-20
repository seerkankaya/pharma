import type { IlacKurali } from '@scalpiq/sut-motoru';
import {
  epostaDuzelt,
  EpostaKullanimdaHatasi,
  type Eczane,
  type HesapDeposu,
  type Kullanici,
  type OturumKullanicisi,
  type YeniKullanici,
} from '../hesap.js';
import type { DenetimKaydi, KayitliKontrol, KontrolDeposu } from '../kontrol-deposu.js';
import type { KuralDegisikligi, KuralDeposu } from '../kural-deposu.js';
import { islemIcinde, type Havuz } from './baglanti.js';

const KULLANICI_ALANLARI = `id, eczane_id as "eczaneId", eposta, ad_soyad as "adSoyad", rol,
  kural_yetkisi as "kuralYetkisi", aktif, parola_ozeti as "parolaOzeti"`;

export class PgHesapDeposu implements HesapDeposu {
  constructor(private readonly havuz: Havuz) {}

  async eczaneEkle(ad: string): Promise<Eczane> {
    const { rows } = await this.havuz.query<Eczane>('insert into eczane (ad) values ($1) returning id, ad', [ad]);
    return rows[0]!;
  }

  async kullaniciEkle(k: YeniKullanici): Promise<Kullanici> {
    try {
      const { rows } = await this.havuz.query<Kullanici>(
        `insert into kullanici (eczane_id, eposta, ad_soyad, rol, kural_yetkisi, parola_ozeti)
         values ($1, $2, $3, $4, $5, $6) returning ${KULLANICI_ALANLARI}`,
        [k.eczaneId, epostaDuzelt(k.eposta), k.adSoyad, k.rol, k.kuralYetkisi, k.parolaOzeti],
      );
      return rows[0]!;
    } catch (e) {
      if ((e as { code?: string }).code === '23505') throw new EpostaKullanimdaHatasi(epostaDuzelt(k.eposta));
      throw e;
    }
  }

  async epostaylaBul(eposta: string) {
    const { rows } = await this.havuz.query<Kullanici>(`select ${KULLANICI_ALANLARI} from kullanici where eposta = $1`, [
      epostaDuzelt(eposta),
    ]);
    return rows[0];
  }

  async eczaneKullanicilari(eczaneId: string) {
    const { rows } = await this.havuz.query<Kullanici>(
      `select ${KULLANICI_ALANLARI} from kullanici where eczane_id = $1 order by ad_soyad`,
      [eczaneId],
    );
    return rows;
  }

  async kullaniciDurumu(id: string, eczaneId: string, aktif: boolean) {
    return islemIcinde(this.havuz, async (c) => {
      const { rowCount } = await c.query('update kullanici set aktif = $3 where id = $1 and eczane_id = $2', [id, eczaneId, aktif]);
      if (!rowCount) return false;
      if (!aktif) await c.query('delete from oturum where kullanici_id = $1', [id]);
      return true;
    });
  }

  async oturumEkle(belirtecOzeti: string, kullaniciId: string, bitis: Date) {
    await this.havuz.query('insert into oturum (belirtec_ozeti, kullanici_id, bitis) values ($1, $2, $3)', [belirtecOzeti, kullaniciId, bitis]);
    // Süresi dolmuş oturumları ara ara temizle.
    await this.havuz.query('delete from oturum where bitis < now() - interval \'1 day\'');
  }

  async oturumBul(belirtecOzeti: string, simdi: Date) {
    const { rows } = await this.havuz.query<OturumKullanicisi>(
      `select k.id, k.eczane_id as "eczaneId", e.ad as "eczaneAd", k.eposta, k.ad_soyad as "adSoyad", k.rol,
              k.kural_yetkisi as "kuralYetkisi"
         from oturum o join kullanici k on k.id = o.kullanici_id join eczane e on e.id = k.eczane_id
        where o.belirtec_ozeti = $1 and o.bitis > $2 and k.aktif`,
      [belirtecOzeti, simdi],
    );
    return rows[0];
  }

  async oturumSil(belirtecOzeti: string) {
    await this.havuz.query('delete from oturum where belirtec_ozeti = $1', [belirtecOzeti]);
  }
}

export class PgKuralDeposu implements KuralDeposu {
  constructor(private readonly havuz: Havuz) {}

  async listele() {
    const { rows } = await this.havuz.query<{ veri: IlacKurali }>('select veri from ilac_kurali order by id');
    return rows.map((r) => r.veri);
  }

  /** Kitaplık boşsa verilen kuralları ekler (geliştirme ortamında örnek kurallar için). */
  async bossaDoldur(kurallar: IlacKurali[]) {
    await this.degistir((mevcut) => ({ sonuc: undefined, kaydet: mevcut.length ? [] : kurallar }));
  }

  degistir<T>(islem: (kurallar: IlacKurali[]) => KuralDegisikligi<T>): Promise<T> {
    return islemIcinde(this.havuz, async (c) => {
      // Okuma ile yazma arasında başka bir değişiklik araya girmesin.
      await c.query('lock table ilac_kurali in share row exclusive mode');
      const { rows } = await c.query<{ veri: IlacKurali }>('select veri from ilac_kurali order by id');
      const d = islem(rows.map((r) => r.veri));
      for (const k of d.kaydet ?? [])
        await c.query('insert into ilac_kurali (id, veri) values ($1, $2) on conflict (id) do update set veri = excluded.veri', [
          k.id,
          JSON.stringify(k),
        ]);
      if (d.sil?.length) await c.query('delete from ilac_kurali where id = any($1)', [d.sil]);
      return d.sonuc;
    });
  }
}

interface KontrolSatiri {
  id: string;
  eczaneId: string;
  kullaniciId: string;
  recete: KayitliKontrol['recete'];
  sonuc: KayitliKontrol['sonuc'];
  durum: KayitliKontrol['durum'];
  takipNo: string | null;
}

export class PgKontrolDeposu implements KontrolDeposu {
  constructor(private readonly havuz: Havuz) {}

  async ekle(k: Omit<KayitliKontrol, 'durum' | 'takipNo'>) {
    await this.havuz.query('insert into kontrol (id, eczane_id, kullanici_id, recete, sonuc) values ($1, $2, $3, $4, $5)', [
      k.id,
      k.eczaneId,
      k.kullaniciId,
      JSON.stringify(k.recete),
      JSON.stringify(k.sonuc),
    ]);
  }

  async al(id: string, eczaneId: string): Promise<KayitliKontrol | undefined> {
    // Kimlik uuid değilse veritabanı hata verir; bulunamadı sayılır.
    if (!/^[0-9a-f-]{36}$/i.test(id)) return undefined;
    const { rows } = await this.havuz.query<KontrolSatiri>(
      `select id, eczane_id as "eczaneId", kullanici_id as "kullaniciId", recete, sonuc, durum, takip_no as "takipNo"
         from kontrol where id = $1 and eczane_id = $2`,
      [id, eczaneId],
    );
    const r = rows[0];
    return r && { ...r, takipNo: r.takipNo ?? undefined };
  }

  async gonderimiBaslat(id: string) {
    const { rowCount } = await this.havuz.query("update kontrol set durum = 'gonderiliyor' where id = $1 and durum = 'bekliyor'", [id]);
    return rowCount === 1;
  }

  async gonderimiBirak(id: string) {
    await this.havuz.query("update kontrol set durum = 'bekliyor' where id = $1 and durum = 'gonderiliyor'", [id]);
  }

  async gonderimiTamamla(id: string, kayit: DenetimKaydi) {
    await islemIcinde(this.havuz, async (c) => {
      const { rows } = await c.query<{ eczaneId: string }>(
        `update kontrol set durum = 'gonderildi', takip_no = $2 where id = $1 and durum = 'gonderiliyor' returning eczane_id as "eczaneId"`,
        [id, kayit.takipNo ?? null],
      );
      if (!rows[0]) throw new Error(`Kontrol ${id} gönderim aşamasında değil`);
      await c.query('insert into denetim (eczane_id, kontrol_id, zaman, kayit) values ($1, $2, $3, $4)', [
        rows[0].eczaneId,
        id,
        kayit.zaman,
        JSON.stringify(kayit),
      ]);
    });
  }

  async denetimKayitlari(eczaneId: string) {
    const { rows } = await this.havuz.query<{ kayit: DenetimKaydi }>(
      'select kayit from denetim where eczane_id = $1 order by sira desc limit 500',
      [eczaneId],
    );
    return rows.map((r) => r.kayit);
  }
}
