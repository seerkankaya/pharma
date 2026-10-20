// API'nin stok ve satış yanıtları. Sunucudaki apps/api/src/stok/stok.ts ile aynı biçimdedir.

export interface Urun {
  barkod: string;
  ad: string;
  ilac: boolean;
  kdvOrani: 0 | 1 | 10 | 20;
  satisFiyatiKurus: number;
  kritikStok?: number;
}

export interface Parti {
  partiNo: string;
  skt: string;
  miktar: number;
}

export type StokUyarisi =
  | { tur: 'miadi-gecmis'; partiNo: string; skt: string; miktar: number }
  | { tur: 'miadi-yakin'; partiNo: string; skt: string; miktar: number; kalanGun: number }
  | { tur: 'kritik-stok'; miktar: number; kritikStok: number };

export interface StokSatiri {
  urun: Urun;
  miktar: number;
  partiler: Parti[];
  uyarilar: StokUyarisi[];
}

export interface Satis {
  id: string;
  zaman: string;
  satan: string;
  odemeTuru: 'nakit' | 'kart';
  kalemler: { barkod: string; ad: string; miktar: number; birimFiyatKurus: number; tutarKurus: number }[];
  toplamKurus: number;
  kdvKurus: number;
}
