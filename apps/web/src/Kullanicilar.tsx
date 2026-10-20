import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { istek, IstekHatasi } from './api';

interface Kullanici {
  id: string;
  eposta: string;
  adSoyad: string;
  rol: 'eczaci' | 'calisan';
  kuralYetkisi: boolean;
  aktif: boolean;
}

const ROL_ADI = { eczaci: 'Eczacı', calisan: 'Çalışan' } as const;
const BOS_FORM = { eposta: '', adSoyad: '', rol: 'calisan' as Kullanici['rol'], parola: '' };

export function Kullanicilar({ benimId }: { benimId: string }) {
  const [liste, setListe] = useState<Kullanici[]>([]);
  const [form, setForm] = useState(BOS_FORM);
  const [hata, setHata] = useState<{ metin: string; ayrinti?: string[] }>();

  const yukle = useCallback(() => istek<Kullanici[]>('/api/kullanicilar').then(setListe), []);
  useEffect(() => {
    yukle().catch((e) => setHata({ metin: (e as Error).message }));
  }, [yukle]);

  async function islem(f: () => Promise<unknown>) {
    setHata(undefined);
    try {
      await f();
      await yukle();
      return true;
    } catch (e) {
      setHata({ metin: (e as Error).message, ayrinti: e instanceof IstekHatasi ? e.hatalar : undefined });
      return false;
    }
  }

  async function ekle(e: FormEvent) {
    e.preventDefault();
    if (await islem(() => istek('/api/kullanicilar', form))) setForm(BOS_FORM);
  }

  function durumDegistir(k: Kullanici) {
    const soru = k.aktif ? `${k.adSoyad} kapatılsın mı? Açık oturumları hemen kapanır.` : `${k.adSoyad} yeniden açılsın mı?`;
    if (window.confirm(soru)) void islem(() => istek(`/api/kullanicilar/${k.id}/durum`, { aktif: !k.aktif }));
  }

  const alan = (ad: keyof typeof BOS_FORM) => ({
    value: form[ad],
    onChange: (e: { target: { value: string } }) => setForm((f) => ({ ...f, [ad]: e.target.value })),
  });

  return (
    <>
      <p className="soluk">Eczanenizde çalışanların hesapları. Ayrılan çalışanın hesabını kapatın; geçmiş denetim kayıtlarında adı kalır.</p>
      <form className="kart form" onSubmit={ekle}>
        <fieldset>
          <legend>Yeni kullanıcı</legend>
          <label>Ad soyad<input required {...alan('adSoyad')} /></label>
          <label>E-posta<input type="email" required {...alan('eposta')} /></label>
          <label>
            Rol
            <select {...alan('rol')}>
              <option value="calisan">Çalışan</option>
              <option value="eczaci">Eczacı</option>
            </select>
          </label>
          <label>Geçici parola<input type="password" autoComplete="new-password" minLength={10} required {...alan('parola')} /></label>
        </fieldset>
        <div className="eylemler">
          <button className="birincil" type="submit">
            Kullanıcı ekle
          </button>
        </div>
      </form>

      {hata && (
        <div className="mesaj hata">
          {hata.metin}
          {hata.ayrinti && (
            <ul>
              {hata.ayrinti.map((h) => (
                <li key={h}>{h}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <section className="kart">
        <table>
          <thead>
            <tr>
              <th>Ad soyad</th>
              <th>E-posta</th>
              <th>Rol</th>
              <th>Durum</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {liste.map((k) => (
              <tr key={k.id}>
                <td>
                  {k.adSoyad}
                  {k.kuralYetkisi && <div className="soluk">Kural yetkisi var</div>}
                </td>
                <td>{k.eposta}</td>
                <td>{ROL_ADI[k.rol]}</td>
                <td>
                  <span className={`etiket ${k.aktif ? 'onayli' : 'kapali'}`}>{k.aktif ? 'Açık' : 'Kapalı'}</span>
                </td>
                <td className="satir-eylem">
                  {k.id !== benimId && <button onClick={() => durumDegistir(k)}>{k.aktif ? 'Kapat' : 'Aç'}</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
