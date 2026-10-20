import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { istek, IstekHatasi } from './api';
import { kurusa, tl } from './para';
import type { Urun } from './stok-tipleri';

interface Tedarikci {
  id: string;
  ad: string;
  vergiNo?: string;
  telefon?: string;
}

interface Fatura {
  id: string;
  tedarikciAd: string;
  faturaNo: string;
  tarih: string;
  kalemler: { barkod: string; ad: string; miktar: number; malFazlasi: number }[];
  toplamKurus: number;
  kaydeden: string;
}

interface Oneri {
  urun: Urun;
  stok: number;
  oneri: number;
  sonTedarikci?: string;
  sonMaliyetKurus?: number;
}

interface Satir {
  barkod: string;
  ad: string;
  kartVar: boolean;
  miktar: string;
  mf: string;
  partiNo: string;
  skt: string;
  fiyat: string;
  kdv: string;
  iskonto: string;
  satisFiyati: string;
}

const BOS_SATIR: Satir = { barkod: '', ad: '', kartVar: false, miktar: '', mf: '', partiNo: '', skt: '', fiyat: '', kdv: '10', iskonto: '', satisFiyati: '' };

export function Alis({ eczaci }: { eczaci: boolean }) {
  const [tedarikciler, setTedarikciler] = useState<Tedarikci[]>([]);
  const [faturalar, setFaturalar] = useState<Fatura[]>([]);
  const [oneriler, setOneriler] = useState<Oneri[]>([]);
  const [yeniTedarikci, setYeniTedarikci] = useState({ ad: '', vergiNo: '' });
  const [baslik, setBaslik] = useState({ tedarikciId: '', faturaNo: '', tarih: '' });
  const [satirlar, setSatirlar] = useState<Satir[]>([{ ...BOS_SATIR }]);
  const [hata, setHata] = useState<{ metin: string; ayrinti?: string[] }>();
  const [bilgi, setBilgi] = useState<string>();

  const yukle = useCallback(async () => {
    const [t, f, o] = await Promise.all([
      istek<Tedarikci[]>('/api/tedarikciler'),
      istek<Fatura[]>('/api/alis-faturalari'),
      istek<Oneri[]>('/api/siparis-onerisi'),
    ]);
    setTedarikciler(t);
    setFaturalar(f);
    setOneriler(o);
  }, []);
  useEffect(() => {
    yukle().catch((e) => setHata({ metin: (e as Error).message }));
    istek<{ bugun: string }>('/api/bugun').then(({ bugun }) => setBaslik((b) => ({ ...b, tarih: b.tarih || bugun })), () => undefined);
  }, [yukle]);

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

  async function tedarikciEkle(e: FormEvent) {
    e.preventDefault();
    const govde = { ad: yeniTedarikci.ad, vergiNo: yeniTedarikci.vergiNo || undefined };
    if (await islem(() => istek('/api/tedarikciler', govde), `${yeniTedarikci.ad} eklendi`)) setYeniTedarikci({ ad: '', vergiNo: '' });
  }

  const satirDegis = (i: number, alan: keyof Satir, deger: string | boolean) =>
    setSatirlar((s) => s.map((r, j) => (j === i ? { ...r, [alan]: deger } : r)));

  // Barkod girilince kart varsa adını ve KDV'sini doldurur; yoksa EK-4/A önerisini getirir.
  async function barkodBul(i: number) {
    const b = satirlar[i]!.barkod.trim();
    if (!b) return;
    try {
      const { kart, oneri } = await istek<{ kart?: Urun; oneri?: Partial<Urun> }>(`/api/urunler/${encodeURIComponent(b)}`);
      const u = kart ?? oneri!;
      setSatirlar((s) => s.map((r, j) => (j === i ? { ...r, ad: u.ad ?? r.ad, kdv: String(u.kdvOrani ?? r.kdv), kartVar: !!kart } : r)));
    } catch {
      satirDegis(i, 'kartVar', false);
    }
  }

  async function faturaKaydet(e: FormEvent) {
    e.preventDefault();
    const kalemler = satirlar.map((r) => ({
      barkod: r.barkod.trim(),
      ad: r.kartVar ? undefined : r.ad,
      miktar: Number(r.miktar),
      malFazlasi: r.mf.trim() ? Number(r.mf) : undefined,
      partiNo: r.partiNo,
      skt: r.skt,
      birimFiyatKurus: kurusa(r.fiyat) ?? -1,
      kdvOrani: Number(r.kdv),
      iskontoYuzde: r.iskonto.trim() ? Number(r.iskonto.replace(',', '.')) : undefined,
      satisFiyatiKurus: r.kartVar ? undefined : kurusa(r.satisFiyati),
    }));
    const ok = await islem(() => istek('/api/alis-faturalari', { ...baslik, kalemler }), `${baslik.faturaNo} numaralı fatura kaydedildi, ürünler stoğa girdi`);
    if (ok) {
      setBaslik((b) => ({ ...b, faturaNo: '' }));
      setSatirlar([{ ...BOS_SATIR }]);
    }
  }

  const tahmini = satirlar.reduce((t, r) => {
    const net = (kurusa(r.fiyat) ?? 0) * (Number(r.miktar) || 0) * (1 - (Number(r.iskonto.replace(',', '.')) || 0) / 100);
    return t + Math.round(net * (1 + Number(r.kdv) / 100));
  }, 0);

  return (
    <>
      {oneriler.length > 0 && (
        <section className="kart">
          <h2>Sipariş önerisi <span className="soluk">· kritik stoğa inen {oneriler.length} ürün</span></h2>
          <table>
            <thead>
              <tr>
                <th>Ürün</th>
                <th>Stok / kritik</th>
                <th>Önerilen</th>
                <th>Son alış</th>
              </tr>
            </thead>
            <tbody>
              {oneriler.map((o) => (
                <tr key={o.urun.barkod}>
                  <td>
                    <strong>{o.urun.ad}</strong>
                    <div className="soluk">{o.urun.barkod}</div>
                  </td>
                  <td>
                    <span className={`rozet ${o.stok === 0 ? 'kirmizi' : 'sari'}`}>
                      {o.stok} / {o.urun.kritikStok}
                    </span>
                  </td>
                  <td>
                    <strong>{o.oneri}</strong> adet
                  </td>
                  <td>{o.sonTedarikci ? `${o.sonTedarikci} · ${tl(o.sonMaliyetKurus!)}` : <span className="soluk">alış yok</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <form className="kart form" onSubmit={faturaKaydet}>
        <fieldset>
          <legend>Alış faturası</legend>
          <label>
            Tedarikçi
            <select required value={baslik.tedarikciId} onChange={(e) => setBaslik((b) => ({ ...b, tedarikciId: e.target.value }))}>
              <option value="">Seçin</option>
              {tedarikciler.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.ad}
                </option>
              ))}
            </select>
          </label>
          <label>Fatura no<input required value={baslik.faturaNo} onChange={(e) => setBaslik((b) => ({ ...b, faturaNo: e.target.value }))} /></label>
          <label>Fatura tarihi<input required type="date" value={baslik.tarih} onChange={(e) => setBaslik((b) => ({ ...b, tarih: e.target.value }))} /></label>
        </fieldset>

        <div className="fatura-satirlari">
          <table>
            <thead>
              <tr>
                <th>Barkod</th>
                <th>Ürün</th>
                <th>Adet</th>
                <th>MF</th>
                <th>Parti</th>
                <th>SKT</th>
                <th>Birim fiyat (KDV hariç)</th>
                <th>KDV</th>
                <th>İsk. %</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {satirlar.map((r, i) => (
                <tr key={i}>
                  <td><input required inputMode="numeric" value={r.barkod} onChange={(e) => satirDegis(i, 'barkod', e.target.value)} onBlur={() => barkodBul(i)} /></td>
                  <td>
                    <input required placeholder="Ürün adı" value={r.ad} disabled={r.kartVar} onChange={(e) => satirDegis(i, 'ad', e.target.value)} />
                    {!r.kartVar && r.barkod && (
                      <input className="ek" placeholder="Satış fiyatı (KDV dahil)" value={r.satisFiyati} onChange={(e) => satirDegis(i, 'satisFiyati', e.target.value)} />
                    )}
                  </td>
                  <td><input required className="dar" type="number" min={1} value={r.miktar} onChange={(e) => satirDegis(i, 'miktar', e.target.value)} /></td>
                  <td><input className="dar" type="number" min={0} value={r.mf} onChange={(e) => satirDegis(i, 'mf', e.target.value)} /></td>
                  <td><input required className="orta" value={r.partiNo} onChange={(e) => satirDegis(i, 'partiNo', e.target.value)} /></td>
                  <td><input required type="date" value={r.skt} onChange={(e) => satirDegis(i, 'skt', e.target.value)} /></td>
                  <td><input required className="orta" placeholder="0,00" value={r.fiyat} onChange={(e) => satirDegis(i, 'fiyat', e.target.value)} /></td>
                  <td>
                    <select value={r.kdv} onChange={(e) => satirDegis(i, 'kdv', e.target.value)}>
                      <option value="10">%10</option>
                      <option value="20">%20</option>
                      <option value="1">%1</option>
                      <option value="0">%0</option>
                    </select>
                  </td>
                  <td><input className="dar" value={r.iskonto} onChange={(e) => satirDegis(i, 'iskonto', e.target.value)} /></td>
                  <td>
                    {satirlar.length > 1 && (
                      <button type="button" className="ikon-dugme" aria-label="Satırı sil" onClick={() => setSatirlar((s) => s.filter((_, j) => j !== i))}>
                        ×
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="eylemler">
          <button type="button" onClick={() => setSatirlar((s) => [...s, { ...BOS_SATIR, kdv: s.at(-1)?.kdv ?? '10' }])}>
            Satır ekle
          </button>
          <strong className="toplam">Tahmini toplam {tl(tahmini)}</strong>
          <button className="birincil" type="submit">
            Faturayı kaydet ve stoğa al
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
      {bilgi && <div className="mesaj basari">{bilgi}</div>}

      <div className="iki-sutun">
        <section className="kart">
          <h2>Son faturalar</h2>
          <table>
            <tbody>
              {faturalar.slice(0, 20).map((f) => (
                <tr key={f.id}>
                  <td>
                    <strong>{f.faturaNo}</strong>
                    <div className="soluk">
                      {f.tedarikciAd} · {new Date(f.tarih).toLocaleDateString('tr-TR')} · {f.kaydeden}
                    </div>
                  </td>
                  <td>{f.kalemler.reduce((t, k) => t + k.miktar + k.malFazlasi, 0)} kutu</td>
                  <td>{tl(f.toplamKurus)}</td>
                </tr>
              ))}
              {faturalar.length === 0 && (
                <tr>
                  <td className="soluk">Henüz fatura girilmedi.</td>
                </tr>
              )}
            </tbody>
          </table>
        </section>

        <section className="kart">
          <h2>Tedarikçiler</h2>
          <table>
            <tbody>
              {tedarikciler.map((t) => (
                <tr key={t.id}>
                  <td>{t.ad}</td>
                  <td className="soluk">{t.vergiNo ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {eczaci && (
            <form className="eylemler" onSubmit={tedarikciEkle}>
              <input required placeholder="Ecza deposu adı" value={yeniTedarikci.ad} onChange={(e) => setYeniTedarikci((t) => ({ ...t, ad: e.target.value }))} />
              <input placeholder="Vergi no" value={yeniTedarikci.vergiNo} onChange={(e) => setYeniTedarikci((t) => ({ ...t, vergiNo: e.target.value }))} />
              <button type="submit">Ekle</button>
            </form>
          )}
        </section>
      </div>
    </>
  );
}
