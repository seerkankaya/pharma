import type { Ek4aKaydi, Ek4aListesi } from './types.js';

/** Kayıtlardan barkod ile aranabilir bir EK-4/A listesi oluşturur. Eski barkodlar da aynı kayda yönlenir. */
export function haritaListesi(yayimTarihi: string, kayitlar: (Ek4aKaydi & { eskiBarkodlar?: string[] })[]): Ek4aListesi {
  const harita = new Map<string, Ek4aKaydi>();
  for (const k of kayitlar) {
    harita.set(k.barkod, k);
    for (const eski of k.eskiBarkodlar ?? []) if (!harita.has(eski)) harita.set(eski, k);
  }
  return { yayimTarihi, bul: (barkod) => harita.get(barkod.trim()) };
}
