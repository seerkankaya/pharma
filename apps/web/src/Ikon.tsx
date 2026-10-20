// Çizgi ikonlar (24x24, currentColor). Yeni ikon eklerken aynı çizgi kalınlığını koruyun.
const YOLLAR = {
  recete: 'M9 4h6a1 1 0 0 1 1 1v1H8V5a1 1 0 0 1 1-1Zm-3 2h2m8 0h2a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1m3 8 2 2 4-4',
  satis: 'M3 4h2l2.4 11.2a1 1 0 0 0 1 .8h8.9a1 1 0 0 0 1-.8L20 8H6.2M9 20.5a.5.5 0 1 0 0-1 .5.5 0 0 0 0 1Zm8 0a.5.5 0 1 0 0-1 .5.5 0 0 0 0 1Z',
  stok: 'M21 8 12 3 3 8v8l9 5 9-5V8Zm-18 0 9 5 9-5m-9 5v8',
  alis: 'M3 7h11v9H3V7Zm11 3h4l3 3v3h-7m-9 2.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm11 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z',
  musteriler: 'M3 6h18v12H3V6Zm0 4h18M7 15h4',
  kurallar: 'M4 5a2 2 0 0 1 2-2h13v15H6a2 2 0 0 0-2 2V5Zm0 15a2 2 0 0 0 2 2h13v-4M9 8h6m-6 4h4',
  denetim: 'M12 3 4 6v6c0 4.4 3.4 8.2 8 9 4.6-.8 8-4.6 8-9V6l-8-3Zm-3 9 2 2 4-4',
  kullanicilar: 'M16 20v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1m7-9a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm13 9v-1a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  cikis: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4m7 14 5-5-5-5m5 5H9',
  gunes: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0-14v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  ay: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z',
  menu: 'M4 6h16M4 12h16M4 18h16',
  kapat: 'M6 6l12 12M18 6 6 18',
} as const;

export type IkonAdi = keyof typeof YOLLAR;

export function Ikon({ ad, boyut = 20 }: { ad: IkonAdi; boyut?: number }) {
  return (
    <svg width={boyut} height={boyut} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={YOLLAR[ad]} />
    </svg>
  );
}
