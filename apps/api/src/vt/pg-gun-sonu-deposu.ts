import { GunZatenKapaliHatasi, type GunSonu, type GunSonuDeposu } from '../rapor/rapor.js';
import type { Havuz } from './baglanti.js';

export class PgGunSonuDeposu implements GunSonuDeposu {
  constructor(private readonly havuz: Havuz) {}

  async kapat(eczaneId: string, g: GunSonu) {
    try {
      await this.havuz.query(
        'insert into gun_sonu (eczane_id, gun, kullanici_id, zaman, sayilan_nakit_kurus, fark_kurus, veri) values ($1, $2, $3, $4, $5, $6, $7)',
        [eczaneId, g.gun, g.kullaniciId, g.zaman, g.sayilanNakitKurus, g.farkKurus, JSON.stringify(g)],
      );
    } catch (e) {
      if ((e as { code?: string }).code === '23505') throw new GunZatenKapaliHatasi(g.gun);
      throw e;
    }
  }

  async al(eczaneId: string, gun: string) {
    const { rows } = await this.havuz.query<{ veri: GunSonu }>('select veri from gun_sonu where eczane_id = $1 and gun = $2', [eczaneId, gun]);
    return rows[0]?.veri;
  }

  async liste(eczaneId: string, adet: number) {
    const { rows } = await this.havuz.query<{ veri: GunSonu }>('select veri from gun_sonu where eczane_id = $1 order by gun desc limit $2', [
      eczaneId,
      adet,
    ]);
    return rows.map((r) => r.veri);
  }
}
