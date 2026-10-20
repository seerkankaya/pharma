export class IstekHatasi extends Error {
  constructor(
    mesaj: string,
    readonly engeller?: string[],
    readonly hatalar?: string[],
  ) {
    super(mesaj);
  }
}

export async function istek<T>(url: string, govde?: unknown, method = govde === undefined ? 'GET' : 'POST'): Promise<T> {
  const yanit = await fetch(url, {
    method,
    headers: govde === undefined ? undefined : { 'content-type': 'application/json' },
    body: govde === undefined ? undefined : JSON.stringify(govde),
  });
  const veri = yanit.status === 204 ? undefined : await yanit.json();
  if (!yanit.ok) throw new IstekHatasi(veri?.hata ?? 'İstek başarısız', veri?.engeller, veri?.hatalar);
  return veri as T;
}
