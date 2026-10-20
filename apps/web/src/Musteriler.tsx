import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { istek, IstekHatasi } from './api';
import { kurusa, tl } from './para';

export interface Musteri {
  id: string;
  adSoyad: string;
  telefon?: string;
  limitKurus?: number;
  bakiyeKurus: number;
}

interface Hareket {
  tur: 'borc' | 'tahsilat';
  tutarKurus: number;
  odemeTuru?: 'nakit' | 'kart';
  aciklama?: string;
  kaydeden: string;
  zaman: string;
}

interface Detay {
  musteri: Omit<Musteri, 'bakiyeKurus'>;
  bakiyeKurus: number;
  hareketler: Hareket[];
}

export function Musteriler({ eczaci }: { eczaci: boolean }) {
  const [liste, setListe] = useState<Musteri[]>([]);
  const [arama, setArama] = useState('');
  const [secili, setSecili] = useState<string>();
  const [detay, setDetay] = useState<Detay>();
  const [yeni, setYeni] = useState({ adSoyad: '', telefon: '', limit: '' });
  const [tahsilat, setTahsilat] = useState({ tutar: '', odemeTuru: 'nakit' });
  const [hata, setHata] = useState<{ metin: string; ayrinti?: string[] }>();
  const [bilgi, setBilgi] = useState<string>();

  const yukle = useCallback(() => istek<Musteri[]>('/api/musteriler').then(setListe), []);
  useEffect(() => {
    yukle().catch((e) => setHata({ metin: (e as Error).message }));
  }, [yukle]);
  useEffect(() => {
    if (secili) istek<Detay>(`/api/musteriler/${secili}`).then(setDetay, (e) => setHata({ metin: (e as Error).message }));
    else setDetay(undefined);
  }, [secili, liste]);

  async function islem(f: () => Promise<unknown>, basari: string) {
    setHata(undefined);
    setBilgi(undefined);
    try {
      await f();
      await yukle();
      setBilgi(basari);
      return true;
    } catch (e) {
      setHata({ metin: (e as Error).message, ayrinti: e instanceof IstekHatasi ? e.hatalar : undefined });
      return false;
    }
  }

  async function ekle(e: FormEvent) {
    e.preventDefault();
    const limitKurus = yeni.limit.trim() ? kurusa(yeni.limit) : undefined;
    if (yeni.limit.trim() && limitKurus === undefined) return setHata({ metin: 'Limiti 500,00 biçiminde girin' });
    const govde = { adSoyad: yeni.adSoyad, telefon: yeni.telefon || undefined, limitKurus };
    if (await islem(() => istek('/api/musteriler', govde), `${yeni.adSoyad} eklendi`)) setYeni({ adSoyad: '', telefon: '', limit: '' });
  }

  async function tahsilEt(e: FormEvent) {
    e.preventDefault();
    const tutarKurus = kurusa(tahsilat.tutar);
    if (!tutarKurus) return setHata({ metin: 'Tutarı 150,00 biçiminde girin' });
    const ok = await islem(
      () => istek(`/api/musteriler/${secili}/tahsilat`, { tutarKurus, odemeTuru: tahsilat.odemeTuru }),
      `${tl(tutarKurus)} tahsil edildi`,
    );
    if (ok) setTahsilat({ tutar: '', odemeTuru: tahsilat.odemeTuru });
  }

  const kucuk = arama.toLocaleLowerCase('tr-TR');
  const gorunen = liste.filter((m) => m.adSoyad.toLocaleLowerCase('tr-TR').includes(kucuk) || m.telefon?.includes(arama));
  const toplamAlacak = liste.reduce((t, m) => t + m.bakiyeKurus, 0);

  return (
    <>
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
      {bilgi && <div className="mesaj basari">{bilgi}</div>}
      <div className="ozet-kartlari">
        <div className="kart">
          <span className="soluk">Toplam veresiye alacağı</span>
          <strong>{tl(toplamAlacak)}</strong>
        </div>
        <div className="kart">
          <span className="soluk">Borçlu müşteri</span>
          <strong>{liste.filter((m) => m.bakiyeKurus > 0).length}</strong>
        </div>
      </div>

      <div className="iki-sutun">
        <section className="kart">
          <div className="eylemler ust">
            <input className="arama" placeholder="Ad ya da telefonla ara" value={arama} onChange={(e) => setArama(e.target.value)} />
          </div>
          <table>
            <thead>
              <tr>
                <th>Müşteri</th>
                <th>Borç</th>
              </tr>
            </thead>
            <tbody>
              {gorunen.map((m) => (
                <tr key={m.id} className={`secilebilir ${m.id === secili ? 'secili' : ''}`} onClick={() => setSecili(m.id)}>
                  <td>
                    <strong>{m.adSoyad}</strong>
                    <div className="soluk">
                      {m.telefon ?? ''} {m.limitKurus !== undefined && `· limit ${tl(m.limitKurus)}`}
                    </div>
                  </td>
                  <td>{m.bakiyeKurus > 0 ? <span className="rozet sari">{tl(m.bakiyeKurus)}</span> : <span className="soluk">—</span>}</td>
                </tr>
              ))}
              {gorunen.length === 0 && (
                <tr>
                  <td colSpan={2} className="soluk">
                    Müşteri yok.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <form className="form" onSubmit={ekle}>
            <fieldset>
              <legend>Yeni müşteri</legend>
              <label>Ad soyad<input required value={yeni.adSoyad} onChange={(e) => setYeni((y) => ({ ...y, adSoyad: e.target.value }))} /></label>
              <label>Telefon<input value={yeni.telefon} onChange={(e) => setYeni((y) => ({ ...y, telefon: e.target.value }))} /></label>
              {eczaci && (
                <label>Veresiye limiti (₺)<input placeholder="boşsa sınırsız" value={yeni.limit} onChange={(e) => setYeni((y) => ({ ...y, limit: e.target.value }))} /></label>
              )}
            </fieldset>
            <button className="birincil" type="submit">
              Müşteri ekle
            </button>
          </form>
        </section>

        <section className="kart">
          {!detay && <p className="soluk">Hesap dökümünü görmek için soldan bir müşteri seçin.</p>}
          {detay && (
            <>
              <h2>
                {detay.musteri.adSoyad}
                <span className="soluk">· borç {tl(detay.bakiyeKurus)}</span>
              </h2>
              {detay.bakiyeKurus > 0 && (
                <form className="eylemler" onSubmit={tahsilEt}>
                  <input className="tutar" placeholder="Tutar (₺)" value={tahsilat.tutar} onChange={(e) => setTahsilat((t) => ({ ...t, tutar: e.target.value }))} />
                  <select value={tahsilat.odemeTuru} onChange={(e) => setTahsilat((t) => ({ ...t, odemeTuru: e.target.value }))}>
                    <option value="nakit">Nakit</option>
                    <option value="kart">Kart</option>
                  </select>
                  <button className="birincil" type="submit">
                    Tahsil et
                  </button>
                </form>
              )}
              <table>
                <thead>
                  <tr>
                    <th>Tarih</th>
                    <th>İşlem</th>
                    <th>Tutar</th>
                  </tr>
                </thead>
                <tbody>
                  {detay.hareketler.map((h, i) => (
                    <tr key={i}>
                      <td>{new Date(h.zaman).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' })}</td>
                      <td>
                        {h.tur === 'borc' ? 'Veresiye satış' : `Tahsilat (${h.odemeTuru === 'kart' ? 'kart' : 'nakit'})`}
                        <div className="soluk">
                          {h.aciklama ? `${h.aciklama} · ` : ''}
                          {h.kaydeden}
                        </div>
                      </td>
                      <td className={h.tur === 'borc' ? 'borc' : 'alacak'}>
                        {h.tur === 'borc' ? '+' : '−'}
                        {tl(h.tutarKurus)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </section>
      </div>

    </>
  );
}
