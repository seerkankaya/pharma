import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { istek } from './api';
import { tl } from './para';
import type { Musteri } from './Musteriler';
import type { Satis as SatisKaydi, Urun } from './stok-tipleri';

interface SepetKalemi {
  urun: Urun;
  miktar: number;
}

interface GunOzeti {
  gun: string;
  satislar: SatisKaydi[];
  ozet: { adet: number; toplamKurus: number; nakitKurus: number; kartKurus: number; veresiyeKurus: number };
}

export function Satis() {
  const [barkod, setBarkod] = useState('');
  const [sepet, setSepet] = useState<SepetKalemi[]>([]);
  const [mesaj, setMesaj] = useState<{ tur: 'basari' | 'hata'; metin: string }>();
  const [gun, setGun] = useState<GunOzeti>();
  const [mesgul, setMesgul] = useState(false);
  const [musteriler, setMusteriler] = useState<Musteri[]>();
  const [musteriId, setMusteriId] = useState('');
  const barkodKutusu = useRef<HTMLInputElement>(null);

  const gunuYukle = useCallback(() => istek<GunOzeti>('/api/satislar').then(setGun), []);
  useEffect(() => {
    gunuYukle().catch(() => undefined);
  }, [gunuYukle]);

  // Barkod okuyucu barkodu yazıp Enter'a basar.
  async function okut(e: FormEvent) {
    e.preventDefault();
    const b = barkod.trim();
    if (!b) return;
    setBarkod('');
    setMesaj(undefined);
    try {
      const { kart } = await istek<{ kart?: Urun }>(`/api/urunler/${encodeURIComponent(b)}`);
      if (!kart) return setMesaj({ tur: 'hata', metin: `${b}: ürün kartı yok. Eczacı Stok sekmesinden kart açmalı.` });
      setSepet((s) => {
        const var_ = s.find((k) => k.urun.barkod === kart.barkod);
        return var_ ? s.map((k) => (k === var_ ? { ...k, miktar: k.miktar + 1 } : k)) : [...s, { urun: kart, miktar: 1 }];
      });
    } catch (err) {
      setMesaj({ tur: 'hata', metin: (err as Error).message });
    } finally {
      barkodKutusu.current?.focus();
    }
  }

  function miktarDegistir(barkod: string, miktar: number) {
    setSepet((s) => (miktar < 1 ? s.filter((k) => k.urun.barkod !== barkod) : s.map((k) => (k.urun.barkod === barkod ? { ...k, miktar } : k))));
  }

  async function veresiyeAc() {
    try {
      setMusteriler(await istek<Musteri[]>('/api/musteriler'));
    } catch (err) {
      setMesaj({ tur: 'hata', metin: (err as Error).message });
    }
  }

  async function ode(odemeTuru: 'nakit' | 'kart' | 'veresiye') {
    setMesgul(true);
    setMesaj(undefined);
    try {
      const s = await istek<SatisKaydi>('/api/satis', {
        kalemler: sepet.map((k) => ({ barkod: k.urun.barkod, miktar: k.miktar })),
        odemeTuru,
        musteriId: odemeTuru === 'veresiye' ? musteriId : undefined,
      });
      setSepet([]);
      setMusteriler(undefined);
      setMusteriId('');
      const nasil = odemeTuru === 'veresiye' ? `${s.musteriAd} hesabına veresiye` : odemeTuru === 'nakit' ? 'nakit' : 'kart';
      setMesaj({ tur: 'basari', metin: `Satış tamamlandı: ${tl(s.toplamKurus)} (${nasil})` });
      await gunuYukle();
    } catch (err) {
      setMesaj({ tur: 'hata', metin: (err as Error).message });
    } finally {
      setMesgul(false);
      barkodKutusu.current?.focus();
    }
  }

  const toplam = sepet.reduce((t, k) => t + k.urun.satisFiyatiKurus * k.miktar, 0);

  return (
    <>
      <form className="kart eylemler" onSubmit={okut}>
        <input
          ref={barkodKutusu}
          className="barkod"
          autoFocus
          inputMode="numeric"
          placeholder="Barkod okutun ya da yazıp Enter'a basın"
          value={barkod}
          onChange={(e) => setBarkod(e.target.value)}
        />
        <button className="birincil" type="submit">
          Ekle
        </button>
      </form>

      <section className="kart">
        <table>
          <thead>
            <tr>
              <th>Ürün</th>
              <th>Birim fiyat</th>
              <th>Adet</th>
              <th>Tutar</th>
            </tr>
          </thead>
          <tbody>
            {sepet.map((k) => (
              <tr key={k.urun.barkod}>
                <td>
                  {k.urun.ad}
                  <div className="soluk">{k.urun.barkod}</div>
                </td>
                <td>{tl(k.urun.satisFiyatiKurus)}</td>
                <td>
                  <input
                    className="adet"
                    type="number"
                    min={0}
                    value={k.miktar}
                    onChange={(e) => miktarDegistir(k.urun.barkod, Number(e.target.value))}
                  />
                </td>
                <td>{tl(k.urun.satisFiyatiKurus * k.miktar)}</td>
              </tr>
            ))}
            {sepet.length === 0 && (
              <tr>
                <td colSpan={4} className="soluk">
                  Sepet boş
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <div className="eylemler">
          <strong className="toplam">Toplam {tl(toplam)}</strong>
          <button className="gonder" disabled={!sepet.length || mesgul} onClick={() => ode('nakit')}>
            Nakit
          </button>
          <button className="birincil" disabled={!sepet.length || mesgul} onClick={() => ode('kart')}>
            Kart
          </button>
          <button disabled={!sepet.length || mesgul} onClick={veresiyeAc}>
            Veresiye
          </button>
        </div>
        {musteriler && sepet.length > 0 && (
          <div className="eylemler veresiye">
            <select value={musteriId} onChange={(e) => setMusteriId(e.target.value)}>
              <option value="">Müşteri seçin</option>
              {musteriler.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.adSoyad} {m.bakiyeKurus > 0 ? `· borç ${tl(m.bakiyeKurus)}` : ''}
                </option>
              ))}
            </select>
            <button className="birincil" disabled={!musteriId || mesgul} onClick={() => ode('veresiye')}>
              Veresiyeye yaz
            </button>
            {musteriler.length === 0 && <span className="soluk">Önce Müşteriler sayfasından müşteri ekleyin.</span>}
          </div>
        )}
      </section>

      {mesaj && <div className={`mesaj ${mesaj.tur}`}>{mesaj.metin}</div>}

      {gun && (
        <section className="kart">
          <h2>
            Bugünkü satışlar <span className="soluk">· {gun.ozet.adet} satış · {tl(gun.ozet.toplamKurus)} (nakit {tl(gun.ozet.nakitKurus)}, kart {tl(gun.ozet.kartKurus)}, veresiye {tl(gun.ozet.veresiyeKurus)})</span>
          </h2>
          <table>
            <tbody>
              {gun.satislar.map((s) => (
                <tr key={s.id}>
                  <td>{new Date(s.zaman).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}</td>
                  <td>{s.kalemler.map((k) => `${k.miktar} × ${k.ad}`).join(', ')}</td>
                  <td>{s.satan}</td>
                  <td>{s.odemeTuru === 'nakit' ? 'Nakit' : s.odemeTuru === 'kart' ? 'Kart' : `Veresiye · ${s.musteriAd}`}</td>
                  <td>{tl(s.toplamKurus)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}
