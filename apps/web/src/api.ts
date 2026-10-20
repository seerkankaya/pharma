export class IstekHatasi extends Error {
  constructor(
    mesaj: string,
    readonly engeller?: string[],
    readonly hatalar?: string[],
  ) {
    super(mesaj);
  }
}

/** Oturum düştüğünde (401) uygulama giriş ekranına döner. */
export const OTURUM_DUSTU = 'scalpiq:oturum-dustu';

export async function istek<T>(url: string, govde?: unknown, method = govde === undefined ? 'GET' : 'POST'): Promise<T> {
  const yanit = await fetch(url, {
    method,
    headers: govde === undefined ? undefined : { 'content-type': 'application/json' },
    body: govde === undefined ? undefined : JSON.stringify(govde),
  });
  const veri = yanit.status === 204 ? undefined : await yanit.json();
  if (yanit.status === 401 && url !== '/api/giris') window.dispatchEvent(new Event(OTURUM_DUSTU));
  if (!yanit.ok) throw new IstekHatasi(veri?.hata ?? 'İstek başarısız', veri?.engeller, veri?.hatalar);
  return veri as T;
}
