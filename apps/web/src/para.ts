const bicim = new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' });

/** Kuruşu "₺1.234,50" biçiminde yazar. */
export const tl = (kurus: number) => bicim.format(kurus / 100);

/** "12,50" ya da "12.5" girdisini kuruşa çevirir; geçersizse undefined. */
export function kurusa(metin: string): number | undefined {
  const temiz = metin.trim().replace(/\./g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(temiz)) return undefined;
  return Math.round(Number(temiz) * 100);
}
