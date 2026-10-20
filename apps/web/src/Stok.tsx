import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { istek, IstekHatasi } from './api';
import { kurusa, tl } from './para';
import type { Parti, StokSatiri, StokUyarisi, Urun } from './stok-tipleri';

const BOS_KART = { barkod: '', ad: '', kdvOrani: '10', fiyat: '', kritikStok: '' };
const BOS_GIRIS = { barkod: '', miktar: '', partiNo: '', skt: '', maliyet: '' };

function uyariMetni(u: StokUyarisi) {
  if (u.tur === 'miadi-gecmis') return { sinif: 'kirmizi', metin: `Miadı geçti: parti ${u.partiNo}, ${u.miktar} adet` };
  if (u.tur === 'miadi-yakin') return { sinif: 'sari', metin: `Miadına ${u.kalanGun} gün: parti ${u.partiNo}` };
  return { sinif: 'sari', metin: `Kritik stok (${u.kritikStok})` };
}

export function Stok({ eczaci }: { eczaci: boolean }) {
  const [satirlar, setSatirlar] = useState<StokSatiri[]>([]);
  const [kart, setKart] = useState(BOS_KART);
  const [giris, setGiris] = useState(BOS_GIRIS);
  const [hata, setHata] = useState<{ metin: string; ayrinti?: string[] }>();
  const [bilgi, setBilgi] = useState<string>();

  const yukle = useCallback(() => istek<StokSatiri[]>('/api/stok').then(setSatirlar), []);
  useEffect(() => {
    yukle().catch((e) => setHata({ metin: (e as Error).message }));
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

  // Barkod girilince kart varsa doldurur, yoksa EK-4/A'dan ilaç adını önerir.
  async function kartBarkoduBul() {
    const b = kart.barkod.trim();
    if (!b) return;
    try {
      const { kart: k, oneri } = await istek<{ kart?: Urun; oneri?: Partial<Urun> }>(`/api/urunler/${encodeURIComponent(b)}`);
      const u = k ?? oneri!;
      setKart((f) => ({
        ...f,
        ad: u.ad ?? f.ad,
        kdvOrani: String(u.kdvOrani ?? f.kdvOrani),
        fiyat: k ? (k.satisFiyatiKurus / 100).toFixed(2).replace('.', ',') : f.fiyat,
        kritikStok: k?.kritikStok !== undefined ? String(k.kritikStok) : f.kritikStok,
      }));
    } catch {
      // Ne kart ne EK-4/A kaydı var: ilaç dışı ürün, bilgiler elle girilir.
    }
  }

  async function kartKaydet(e: FormEvent) {
    e.preventDefault();
    const satisFiyatiKurus = kurusa(kart.fiyat);
    if (satisFiyatiKurus === undefined) return setHata({ metin: 'Fiyatı 12,50 biçiminde girin' });
    const govde = {
      ad: kart.ad,
      kdvOrani: Number(kart.kdvOrani),
      satisFiyatiKurus,
      kritikStok: kart.kritikStok.trim() ? Number(kart.kritikStok) : undefined,
    };
    if (await islem(() => istek(`/api/urunler/${encodeURIComponent(kart.barkod.trim())}`, govde, 'PUT'), `${kart.ad} kartı kaydedildi`))
      setKart(BOS_KART);
  }

  async function girisYap(e: FormEvent) {
    e.preventDefault();
    const birimMaliyetKurus = giris.maliyet.trim() ? kurusa(giris.maliyet) : undefined;
    if (giris.maliyet.trim() && birimMaliyetKurus === undefined) return setHata({ metin: 'Maliyeti 12,50 biçiminde girin' });
    const govde = { barkod: giris.barkod.trim(), miktar: Number(giris.miktar), partiNo: giris.partiNo, skt: giris.skt, birimMaliyetKurus };
    if (await islem(() => istek('/api/stok/giris', govde), `${giris.miktar} adet stoğa girdi`)) setGiris(BOS_GIRIS);
  }

  function imha(u: Urun, p: Parti) {
    const aciklama = window.prompt(`${u.ad}, parti ${p.partiNo} (${p.miktar} adet) imha edilecek. Gerekçe:`, 'Miadı geçti');
    if (!aciklama) return;
    void islem(
      () => istek('/api/stok/imha', { barkod: u.barkod, partiNo: p.partiNo, skt: p.skt, miktar: p.miktar, aciklama }),
      `${u.ad} parti ${p.partiNo} stoktan düşüldü`,
    );
  }

  const kartAlan = (ad: keyof typeof BOS_KART) => ({
    value: kart[ad],
    onChange: (e: { target: { value: string } }) => setKart((f) => ({ ...f, [ad]: e.target.value })),
  });
  const girisAlan = (ad: keyof typeof BOS_GIRIS) => ({
    value: giris[ad],
    onChange: (e: { target: { value: string } }) => setGiris((f) => ({ ...f, [ad]: e.target.value })),
  });

  return (
    <>
      <p className="sayfa-notu">
        Stok, giriş, satış ve imha hareketlerinden hesaplanır. Hareketler silinmez. Miadı geçmiş parti satılamaz; eczacı imha kaydıyla stoktan düşer.
      </p>

      <div className="iki-sutun">
        {eczaci && (
          <form className="kart form" onSubmit={kartKaydet}>
            <fieldset>
              <legend>Ürün kartı</legend>
              <label>Barkod<input required inputMode="numeric" {...kartAlan('barkod')} onBlur={kartBarkoduBul} /></label>
              <label className="genis">Ad<input required {...kartAlan('ad')} /></label>
              <label>
                KDV
                <select {...kartAlan('kdvOrani')}>
                  <option value="10">%10 (ilaç)</option>
                  <option value="20">%20</option>
                  <option value="1">%1</option>
                  <option value="0">%0</option>
                </select>
              </label>
              <label>Satış fiyatı (KDV dahil, ₺)<input required placeholder="125,50" {...kartAlan('fiyat')} /></label>
              <label>Kritik stok<input type="number" min={0} {...kartAlan('kritikStok')} /></label>
            </fieldset>
            <button className="birincil" type="submit">
              Kartı kaydet
            </button>
          </form>
        )}

        <form className="kart form" onSubmit={girisYap}>
          <fieldset>
            <legend>Stok girişi</legend>
            <label>Barkod<input required inputMode="numeric" {...girisAlan('barkod')} /></label>
            <label>Adet<input required type="number" min={1} {...girisAlan('miktar')} /></label>
            <label>Parti no<input required {...girisAlan('partiNo')} /></label>
            <label>Son kullanma tarihi<input required type="date" {...girisAlan('skt')} /></label>
            <label>Birim maliyet (₺)<input placeholder="isteğe bağlı" {...girisAlan('maliyet')} /></label>
          </fieldset>
          <button className="birincil" type="submit">
            Stoğa al
          </button>
        </form>
      </div>

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

      <section className="kart">
        <table>
          <thead>
            <tr>
              <th>Ürün</th>
              <th>Fiyat</th>
              <th>Stok</th>
              <th>Partiler (SKT)</th>
              <th>Uyarılar</th>
            </tr>
          </thead>
          <tbody>
            {satirlar.map((s) => (
              <tr key={s.urun.barkod}>
                <td>
                  <strong>{s.urun.ad}</strong>
                  <div className="soluk">
                    {s.urun.barkod} {s.urun.ilac && '· ilaç'}
                  </div>
                </td>
                <td>{tl(s.urun.satisFiyatiKurus)}</td>
                <td>{s.miktar}</td>
                <td>
                  {s.partiler.map((p) => (
                    <div key={p.partiNo + p.skt}>
                      {p.partiNo}: {p.miktar} adet · {new Date(p.skt).toLocaleDateString('tr-TR')}
                      {eczaci && s.uyarilar.some((u) => u.tur === 'miadi-gecmis' && u.partiNo === p.partiNo) && (
                        <button className="kucuk" onClick={() => imha(s.urun, p)}>
                          İmha et
                        </button>
                      )}
                    </div>
                  ))}
                  {s.partiler.length === 0 && <span className="soluk">stok yok</span>}
                </td>
                <td>
                  {s.uyarilar.map((u, i) => {
                    const m = uyariMetni(u);
                    return (
                      <div key={i}>
                        <span className={`rozet ${m.sinif}`}>{m.metin}</span>
                      </div>
                    );
                  })}
                </td>
              </tr>
            ))}
            {satirlar.length === 0 && (
              <tr>
                <td colSpan={5} className="soluk">
                  Henüz ürün kartı yok.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </>
  );
}
