import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { istek, IstekHatasi, OTURUM_DUSTU } from './api';

interface Surum {
  id: string;
  yayimTarihi: string;
  dosyaAdi?: string;
  yukleyen: string;
  zaman: string;
  kayitSayisi: number;
}

interface Bilgi {
  aktif: { yayimTarihi: string; kayitSayisi?: number; yukleyen?: string; zaman?: string; ornek: boolean };
  surumler: Surum[];
}

interface Kayit {
  barkod: string;
  ad: string;
  kamuNo?: string;
  esdegerGrubu?: string;
}

const tarih = (t: string) => new Date(`${t}T12:00:00`).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });

/** Excel dosyasını ham gövdeyle gönderir; yanıt istek() ile aynı biçimde işlenir. */
async function dosyaGonder(url: string, dosya: File) {
  const yanit = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: await dosya.arrayBuffer() });
  const veri = await yanit.json().catch(() => ({}));
  if (yanit.status === 401) window.dispatchEvent(new Event(OTURUM_DUSTU));
  if (!yanit.ok) throw new IstekHatasi(veri?.hata ?? 'Yükleme başarısız', undefined, veri?.uyarilar, veri);
  return veri as { surum: Surum; sayfa: string; uyarilar: string[]; uyariSayisi: number };
}

export function Ek4aKarti({ yukleyebilir }: { yukleyebilir: boolean }) {
  const [bilgi, setBilgi] = useState<Bilgi>();
  const [acik, setAcik] = useState(false);
  const [dosya, setDosya] = useState<File>();
  const [yayim, setYayim] = useState('');
  const [mesgul, setMesgul] = useState(false);
  const [sonuc, setSonuc] = useState<{ tur: 'basari' | 'hata'; metin: string; ayrinti?: string[]; onayGerekli?: boolean }>();
  const [arama, setArama] = useState('');
  const [bulunan, setBulunan] = useState<Kayit[]>();

  const yukle = useCallback(() => istek<Bilgi>('/api/ek4a').then(setBilgi), []);
  useEffect(() => {
    void yukle();
  }, [yukle]);

  useEffect(() => {
    if (arama.trim().length < 3) return setBulunan(undefined);
    const z = setTimeout(() => istek<Kayit[]>(`/api/ek4a/ara?q=${encodeURIComponent(arama)}`).then(setBulunan), 250);
    return () => clearTimeout(z);
  }, [arama, bilgi]);

  async function gonder(e: Pick<FormEvent, 'preventDefault'>, zorla = false) {
    e.preventDefault();
    if (!dosya || !yayim) return;
    setMesgul(true);
    setSonuc(undefined);
    try {
      const r = await dosyaGonder(`/api/ek4a?yayimTarihi=${yayim}&dosyaAdi=${encodeURIComponent(dosya.name)}${zorla ? '&zorla=1' : ''}`, dosya);
      setSonuc({
        tur: 'basari',
        metin: `${tarih(r.surum.yayimTarihi)} tarihli liste yüklendi: ${r.surum.kayitSayisi.toLocaleString('tr-TR')} ilaç ("${r.sayfa}" sayfası). Kontroller artık bu listeyle yapılıyor.`,
        ayrinti: r.uyariSayisi ? [...r.uyarilar.slice(0, 5), ...(r.uyariSayisi > 5 ? [`ve ${r.uyariSayisi - 5} uyarı daha`] : [])] : undefined,
      });
      setDosya(undefined);
      setAcik(false);
      await yukle();
    } catch (err) {
      const govde = err instanceof IstekHatasi ? (err.govde as { onayGerekli?: boolean } | undefined) : undefined;
      setSonuc({ tur: 'hata', metin: (err as Error).message, ayrinti: err instanceof IstekHatasi ? err.hatalar : undefined, onayGerekli: govde?.onayGerekli });
    } finally {
      setMesgul(false);
    }
  }

  if (!bilgi) return null;
  const a = bilgi.aktif;

  return (
    <section className="kart">
      <h2>
        EK-4/A ilaç listesi
        {a.ornek ? <span className="rozet sari">Örnek liste</span> : <span className="rozet yesil">{tarih(a.yayimTarihi)}</span>}
        {yukleyebilir && (
          <button className="sag" onClick={() => setAcik((x) => !x)}>
            {acik ? 'Vazgeç' : 'Yeni liste yükle'}
          </button>
        )}
      </h2>
      <p className="soluk">
        {a.ornek
          ? 'Henüz SGK listesi yüklenmedi; kontroller örnek listeyle yapılıyor. SGK sitesinden güncel EK-4/A Excel dosyasını indirip yükleyin.'
          : `${a.kayitSayisi?.toLocaleString('tr-TR')} ilaç · ${a.yukleyen} yükledi, ${new Date(a.zaman!).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' })}. Listede olmayan barkodun bedeli ödenmez; kontrol bunu kırmızı gösterir.`}
      </p>

      {acik && (
        <form className="eylemler ek4a-formu" onSubmit={(e) => gonder(e)}>
          <label>
            Excel dosyası
            <input type="file" accept=".xlsx,.xls" required onChange={(e) => setDosya(e.target.files?.[0])} />
          </label>
          <label>
            Yayım tarihi
            <input type="date" required value={yayim} onChange={(e) => setYayim(e.target.value)} />
          </label>
          <button className="birincil" type="submit" disabled={mesgul || !dosya || !yayim}>
            {mesgul ? 'Yükleniyor…' : 'Yükle'}
          </button>
        </form>
      )}

      {sonuc && (
        <div className={`mesaj ${sonuc.tur}`}>
          {sonuc.metin}
          {sonuc.ayrinti && (
            <ul>
              {sonuc.ayrinti.map((h) => (
                <li key={h}>{h}</li>
              ))}
            </ul>
          )}
          {sonuc.onayGerekli && (
            <div className="eylemler">
              <button className="birincil" onClick={(e) => gonder(e, true)}>
                Dosya doğru, yine de yükle
              </button>
            </div>
          )}
        </div>
      )}

      <div className="eylemler">
        <input className="arama" placeholder="Listede ara: barkod ya da ilaç adı" value={arama} onChange={(e) => setArama(e.target.value)} />
      </div>
      {bulunan && (
        <table>
          <thead>
            <tr>
              <th>Barkod</th>
              <th>İlaç</th>
              <th>Eşdeğer grubu</th>
            </tr>
          </thead>
          <tbody>
            {bulunan.map((k) => (
              <tr key={k.barkod}>
                <td>
                  <code>{k.barkod}</code>
                </td>
                <td>{k.ad}</td>
                <td>{k.esdegerGrubu ?? '—'}</td>
              </tr>
            ))}
            {bulunan.length === 0 && (
              <tr>
                <td colSpan={3}>
                  <span className="rozet kirmizi">Listede yok</span> <span className="soluk">Bu ilacın bedeli SGK tarafından ödenmez.</span>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </section>
  );
}
