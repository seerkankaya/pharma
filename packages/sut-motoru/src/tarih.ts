// ISO tarih (YYYY-AA-GG) yardımcıları. UTC üzerinden gün farkı hesaplanır.

const GUN_MS = 86_400_000;

function gunNo(tarih: string): number {
  const ms = Date.parse(`${tarih}T00:00:00Z`);
  if (Number.isNaN(ms)) throw new Error(`Geçersiz tarih: ${tarih}`);
  return Math.floor(ms / GUN_MS);
}

/** b - a, gün cinsinden */
export function gunFarki(a: string, b: string): number {
  return gunNo(b) - gunNo(a);
}

export function aralikta(tarih: string, baslangic: string, bitis?: string): boolean {
  if (gunFarki(baslangic, tarih) < 0) return false;
  return bitis === undefined || gunFarki(tarih, bitis) >= 0;
}

export function gunEkle(tarih: string, gun: number): string {
  return new Date((gunNo(tarih) + gun) * GUN_MS).toISOString().slice(0, 10);
}
