import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { istek, IstekHatasi } from './api';
import { kurusa, tl } from './para';

interface Kasa {
  nakitSatisKurus: number;
  nakitTahsilatKurus: number;
  kartSatisKurus: number;
  kartTahsilatKurus: number;
  nakitReceteKurus?: number;
  nakitGelirKurus?: number;
  nakitGiderKurus?: number;
  beklenenNakitKurus: number;
  beklenenKartKurus: number;
}

interface Kapanis {
  gun: string;
  zaman: string;
  kapatan: string;
  satisAdedi: number;
  ciroKurus: number;
  kasa: Kasa;
  sayilanNakitKurus: number;
  farkKurus: number;
  aciklama?: string;
}

interface Ozet {
  adet: number;
  ciroKurus: number;
  nakitKurus: number;
  kartKurus: number;
  veresiyeKurus: number;
  kdvKurus: number;
  matrahKurus: number;
  maliyetKurus: number;
  brutKarKurus: number;
  maliyetsizKutu: number;
  kdvDokumu: { oran: number; tutarKurus: number; matrahKurus: number; kdvKurus: number }[];
}

interface UrunSatisi {
  barkod: string;
  ad: string;
  miktar: number;
  ciroKurus: number;
}

interface GunRaporu {
  gun: string;
  ozet: Ozet;
  kasa: Kasa;
  urunler: UrunSatisi[];
  kapanis: Kapanis | null;
}

interface DonemRaporu {
  toplam: Ozet;
  gunler: { gun: string; adet: number; ciroKurus: number; kdvKurus: number; maliyetKurus: number; brutKarKurus: number }[];
  urunler: UrunSatisi[];
}

interface StokRaporu {
  kalemler: { barkod: string; ad: string; miktar: number; maliyetKurus: number; satisDegeriKurus: number; maliyetsizKutu: number; miadiGecmisKutu: number }[];
  miad: { barkod: string; ad: string; partiNo: string; skt: string; miktar: number; kalanGun: number; maliyetKurus?: number }[];
  toplam: { cesit: number; kutu: number; maliyetKurus: number; satisDegeriKurus: number; maliyetsizKutu: number; miadiGecmisKutu: number };
}

type Bolum = 'gun' | 'donem' | 'stok';

const tarihYaz = (gun: string) => new Date(`${gun}T12:00:00`).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', weekday: 'long' });
const kisaTarih = (gun: string) => new Date(`${gun}T12:00:00`).toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', weekday: 'short' });
const gunEkle = (gun: string, n: number) => new Date(Date.parse(gun) + n * 86_400_000).toISOString().slice(0, 10);

type Hata = { metin: string; ayrinti?: string[] };
const hataYap = (e: unknown): Hata => ({ metin: (e as Error).message, ayrinti: e instanceof IstekHatasi ? e.hatalar : undefined });

function HataKutusu({ hata }: { hata?: Hata }) {
  if (!hata) return null;
  return (
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
  );
}

export function GunSonu({ eczaci }: { eczaci: boolean }) {
  const [bugun, setBugun] = useState<string>();
  const [bolum, setBolum] = useState<Bolum>('gun');

  useEffect(() => {
    istek<{ bugun: string }>('/api/bugun').then((b) => setBugun(b.bugun));
  }, []);

  if (!bugun) return null;
  if (!eczaci) return <KasaSayimi bugun={bugun} />;

  return (
    <>
      <div className="bolumler" role="tablist">
        {(
          [
            ['gun', 'Gün sonu'],
            ['donem', 'Dönem raporu'],
            ['stok', 'Stok değeri ve miat'],
          ] as const
        ).map(([id, ad]) => (
          <button key={id} role="tab" aria-selected={bolum === id} className={bolum === id ? 'secili' : ''} onClick={() => setBolum(id)}>
            {ad}
          </button>
        ))}
      </div>
      {bolum === 'gun' && <GunRaporuBolumu bugun={bugun} />}
      {bolum === 'donem' && <DonemBolumu bugun={bugun} />}
      {bolum === 'stok' && <StokBolumu />}
    </>
  );
}

/** Çalışanın ekranı: beklenen tutarı görmeden kasadaki nakdi sayıp girer. */
function KasaSayimi({ bugun }: { bugun: string }) {
  const [durum, setDurum] = useState<{ kapali: boolean; kapatan?: string; zaman?: string }>();
  const [sonuc, setSonuc] = useState<Kapanis>();
  const [hata, setHata] = useState<Hata>();

  useEffect(() => {
    istek<typeof durum>(`/api/gun-sonu/durum?gun=${bugun}`).then(setDurum, (e) => setHata(hataYap(e)));
  }, [bugun]);

  return (
    <>
      <HataKutusu hata={hata} />
      <section className="kart dar-kart">
        <h2>
          Kasa sayımı <span className="soluk">· {tarihYaz(bugun)}</span>
        </h2>
        {sonuc ? (
          <KapanisOzeti k={sonuc} />
        ) : durum?.kapali ? (
          <p className="soluk">
            Bugünün kasası {durum.kapatan} tarafından {new Date(durum.zaman!).toLocaleTimeString('tr-TR', { timeStyle: 'short', timeZone: 'Europe/Istanbul' })} saatinde kapatıldı.
          </p>
        ) : (
          <>
            <p className="soluk">Çekmecedeki nakdi sayın ve tutarı girin. Beklenen tutar sayımdan sonra gösterilir.</p>
            <KapanisFormu gun={bugun} kapandi={setSonuc} hata={setHata} />
          </>
        )}
      </section>
    </>
  );
}

function KapanisFormu({ gun, kapandi, hata }: { gun: string; kapandi: (k: Kapanis) => void; hata: (h?: Hata) => void }) {
  const [sayilan, setSayilan] = useState('');
  const [aciklama, setAciklama] = useState('');
  const [fark, setFark] = useState<number>();

  async function gonder(e: FormEvent) {
    e.preventDefault();
    hata(undefined);
    const sayilanNakitKurus = kurusa(sayilan);
    if (sayilanNakitKurus === undefined) return hata({ metin: 'Sayılan nakdi 1.250,00 biçiminde girin' });
    try {
      kapandi(await istek<Kapanis>('/api/gun-sonu', { gun, sayilanNakitKurus, aciklama: aciklama || undefined }));
    } catch (err) {
      // Fark varsa sunucu açıklama ister ve farkı söyler.
      const f = err instanceof IstekHatasi ? (err.govde as { farkKurus?: number } | undefined)?.farkKurus : undefined;
      if (f !== undefined) setFark(f);
      hata(hataYap(err));
    }
  }

  return (
    <form className="eylemler kapanis-formu" onSubmit={gonder}>
      <label>
        Sayılan nakit (₺)
        <input className="tutar" inputMode="decimal" required value={sayilan} onChange={(e) => setSayilan(e.target.value)} />
      </label>
      {fark !== undefined && (
        <label className="genis">
          Fark açıklaması ({fark < 0 ? `${tl(-fark)} eksik` : `${tl(fark)} fazla`})
          <input value={aciklama} placeholder="Örn. para üstü yanlış verildi" onChange={(e) => setAciklama(e.target.value)} />
        </label>
      )}
      <button className="birincil" type="submit">
        Kasayı kapat
      </button>
    </form>
  );
}

function KapanisOzeti({ k }: { k: Kapanis }) {
  return (
    <div className="kapanis">
      <div className={`kapanis-fark ${k.farkKurus === 0 ? 'yesil' : k.farkKurus < 0 ? 'kirmizi' : 'sari'}`}>
        {k.farkKurus === 0 ? 'Kasa tuttu' : k.farkKurus < 0 ? `Kasa açığı ${tl(-k.farkKurus)}` : `Kasa fazlası ${tl(k.farkKurus)}`}
      </div>
      <dl className="degerler">
        <dt>Beklenen nakit</dt>
        <dd>{tl(k.kasa.beklenenNakitKurus)}</dd>
        <dt>Sayılan nakit</dt>
        <dd>{tl(k.sayilanNakitKurus)}</dd>
        <dt>POS (kart)</dt>
        <dd>{tl(k.kasa.beklenenKartKurus)}</dd>
        <dt>Kapatan</dt>
        <dd>
          {k.kapatan} · {new Date(k.zaman).toLocaleTimeString('tr-TR', { timeStyle: 'short', timeZone: 'Europe/Istanbul' })}
        </dd>
        {k.aciklama && (
          <>
            <dt>Açıklama</dt>
            <dd>{k.aciklama}</dd>
          </>
        )}
      </dl>
    </div>
  );
}

function OzetKartlari({ o }: { o: Ozet }) {
  const marj = o.matrahKurus > 0 && o.maliyetsizKutu === 0 ? Math.round((o.brutKarKurus / o.matrahKurus) * 1000) / 10 : undefined;
  return (
    <div className="ozet-kartlari">
      <div className="kart">
        <span className="soluk">Ciro (KDV dahil)</span>
        <strong>{tl(o.ciroKurus)}</strong>
        <span className="soluk">{o.adet} satış</span>
      </div>
      <div className="kart">
        <span className="soluk">Ödeme dağılımı</span>
        <div className="dagilim">
          <span>Nakit {tl(o.nakitKurus)}</span>
          <span>Kart {tl(o.kartKurus)}</span>
          <span>Veresiye {tl(o.veresiyeKurus)}</span>
        </div>
      </div>
      <div className="kart">
        <span className="soluk">Hesaplanan KDV</span>
        <strong>{tl(o.kdvKurus)}</strong>
        <span className="soluk">matrah {tl(o.matrahKurus)}</span>
      </div>
      <div className="kart">
        <span className="soluk">Brüt kâr</span>
        <strong>{tl(o.brutKarKurus)}</strong>
        <span className="soluk">
          {marj !== undefined ? `%${marj.toLocaleString('tr-TR')} marj` : o.maliyetsizKutu ? `${o.maliyetsizKutu} kutunun maliyeti girilmemiş, kâra katılmadı` : 'satış yok'}
        </span>
      </div>
    </div>
  );
}

function KdvTablosu({ o }: { o: Ozet }) {
  return (
    <table>
      <thead>
        <tr>
          <th>KDV oranı</th>
          <th className="sayi">Matrah</th>
          <th className="sayi">KDV</th>
          <th className="sayi">Toplam</th>
        </tr>
      </thead>
      <tbody>
        {o.kdvDokumu.map((s) => (
          <tr key={s.oran}>
            <td>%{s.oran}</td>
            <td className="sayi">{tl(s.matrahKurus)}</td>
            <td className="sayi">{tl(s.kdvKurus)}</td>
            <td className="sayi">{tl(s.tutarKurus)}</td>
          </tr>
        ))}
        {o.kdvDokumu.length === 0 && (
          <tr>
            <td colSpan={4} className="soluk">
              Satış yok.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

function UrunTablosu({ urunler }: { urunler: UrunSatisi[] }) {
  return (
    <table>
      <thead>
        <tr>
          <th>Ürün</th>
          <th className="sayi">Adet</th>
          <th className="sayi">Ciro</th>
        </tr>
      </thead>
      <tbody>
        {urunler.map((u) => (
          <tr key={u.barkod}>
            <td>{u.ad}</td>
            <td className="sayi">{u.miktar}</td>
            <td className="sayi">{tl(u.ciroKurus)}</td>
          </tr>
        ))}
        {urunler.length === 0 && (
          <tr>
            <td colSpan={3} className="soluk">
              Satış yok.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

function GunRaporuBolumu({ bugun }: { bugun: string }) {
  const [gun, setGun] = useState(bugun);
  const [rapor, setRapor] = useState<GunRaporu>();
  const [gecmis, setGecmis] = useState<Kapanis[]>([]);
  const [hata, setHata] = useState<Hata>();

  const yukle = useCallback(() => {
    istek<GunRaporu>(`/api/rapor/gun?gun=${gun}`).then(setRapor, (e) => setHata(hataYap(e)));
    istek<Kapanis[]>('/api/gun-sonu').then(setGecmis, () => undefined);
  }, [gun]);
  useEffect(yukle, [yukle]);

  const k = rapor?.kapanis;
  // Kapanıştan sonra yapılan satış ya da tahsilat kapanış kaydında yoktur; eczacı bunu görsün.
  const sonradan = k && rapor && rapor.kasa.beklenenNakitKurus + rapor.kasa.beklenenKartKurus !== k.kasa.beklenenNakitKurus + k.kasa.beklenenKartKurus;

  return (
    <>
      <HataKutusu hata={hata} />
      <div className="eylemler ust gun-secici">
        <button onClick={() => setGun(gunEkle(gun, -1))} aria-label="Önceki gün">
          ‹
        </button>
        <input type="date" value={gun} max={bugun} onChange={(e) => e.target.value && setGun(e.target.value)} />
        <button onClick={() => setGun(gunEkle(gun, 1))} disabled={gun >= bugun} aria-label="Sonraki gün">
          ›
        </button>
        <span className="soluk">{tarihYaz(gun)}</span>
      </div>
      {rapor && (
        <>
          <OzetKartlari o={rapor.ozet} />
          <div className="iki-sutun">
            <section className="kart">
              <h2>
                Kasa kapanışı
                {k ? <span className="rozet yesil">Kapalı</span> : <span className="rozet sari">Açık</span>}
              </h2>
              <dl className="degerler">
                <dt>Nakit satış</dt>
                <dd>{tl(rapor.kasa.nakitSatisKurus)}</dd>
                <dt>Nakit tahsilat (veresiye)</dt>
                <dd>{tl(rapor.kasa.nakitTahsilatKurus)}</dd>
                {!!rapor.kasa.nakitReceteKurus && (
                  <>
                    <dt>Reçete hasta payı (nakit)</dt>
                    <dd>{tl(rapor.kasa.nakitReceteKurus)}</dd>
                  </>
                )}
                {!!rapor.kasa.nakitGelirKurus && (
                  <>
                    <dt>Diğer nakit gelir</dt>
                    <dd>{tl(rapor.kasa.nakitGelirKurus)}</dd>
                  </>
                )}
                {!!rapor.kasa.nakitGiderKurus && (
                  <>
                    <dt>Kasadan ödenen gider</dt>
                    <dd>−{tl(rapor.kasa.nakitGiderKurus)}</dd>
                  </>
                )}
                <dt>
                  <strong>Kasada olması gereken</strong>
                </dt>
                <dd>
                  <strong>{tl(rapor.kasa.beklenenNakitKurus)}</strong>
                </dd>
                <dt>Kart (satış, tahsilat, hasta payı)</dt>
                <dd>{tl(rapor.kasa.beklenenKartKurus)}</dd>
              </dl>
              {k ? (
                <>
                  <KapanisOzeti k={k} />
                  {sonradan && <div className="mesaj uyari">Kasa kapandıktan sonra satış ya da tahsilat yapılmış; yukarıdaki tutarlar kapanıştakinden farklı.</div>}
                </>
              ) : (
                <KapanisFormu gun={gun} kapandi={yukle} hata={setHata} />
              )}
            </section>
            <section className="kart">
              <h2>KDV dökümü</h2>
              <KdvTablosu o={rapor.ozet} />
              <h2 className="ara-baslik">En çok satanlar</h2>
              <UrunTablosu urunler={rapor.urunler} />
            </section>
          </div>
          <section className="kart">
            <h2>Son kapanışlar</h2>
            <table>
              <thead>
                <tr>
                  <th>Gün</th>
                  <th>Kapatan</th>
                  <th className="sayi">Ciro</th>
                  <th className="sayi">Beklenen nakit</th>
                  <th className="sayi">Sayılan</th>
                  <th className="sayi">Fark</th>
                </tr>
              </thead>
              <tbody>
                {gecmis.map((g) => (
                  <tr key={g.gun} className="secilebilir" onClick={() => setGun(g.gun)}>
                    <td>{kisaTarih(g.gun)}</td>
                    <td>{g.kapatan}</td>
                    <td className="sayi">{tl(g.ciroKurus)}</td>
                    <td className="sayi">{tl(g.kasa.beklenenNakitKurus)}</td>
                    <td className="sayi">{tl(g.sayilanNakitKurus)}</td>
                    <td className="sayi">
                      {g.farkKurus === 0 ? <span className="soluk">—</span> : <span className={`rozet ${g.farkKurus < 0 ? 'kirmizi' : 'sari'}`}>{tl(g.farkKurus)}</span>}
                    </td>
                  </tr>
                ))}
                {gecmis.length === 0 && (
                  <tr>
                    <td colSpan={6} className="soluk">
                      Henüz kapanış yok.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>
        </>
      )}
    </>
  );
}

function DonemBolumu({ bugun }: { bugun: string }) {
  const [aralik, setAralik] = useState({ bas: gunEkle(bugun, -29), bit: bugun });
  const [rapor, setRapor] = useState<DonemRaporu>();
  const [hata, setHata] = useState<Hata>();

  useEffect(() => {
    setHata(undefined);
    istek<DonemRaporu>(`/api/rapor/donem?bas=${aralik.bas}&bit=${aralik.bit}`).then(setRapor, (e) => setHata(hataYap(e)));
  }, [aralik]);

  const hazir = (gun: number) => setAralik({ bas: gunEkle(bugun, -(gun - 1)), bit: bugun });
  const ayBasi = `${bugun.slice(0, 8)}01`;
  const enYuksek = Math.max(1, ...(rapor?.gunler.map((g) => g.ciroKurus) ?? []));

  return (
    <>
      <HataKutusu hata={hata} />
      <div className="eylemler ust">
        <input type="date" value={aralik.bas} max={aralik.bit} onChange={(e) => e.target.value && setAralik((a) => ({ ...a, bas: e.target.value }))} />
        <span className="soluk">–</span>
        <input type="date" value={aralik.bit} max={bugun} onChange={(e) => e.target.value && setAralik((a) => ({ ...a, bit: e.target.value }))} />
        <button onClick={() => hazir(7)}>Son 7 gün</button>
        <button onClick={() => hazir(30)}>Son 30 gün</button>
        <button onClick={() => setAralik({ bas: ayBasi, bit: bugun })}>Bu ay</button>
      </div>
      {rapor && (
        <>
          <OzetKartlari o={rapor.toplam} />
          <div className="iki-sutun">
            <section className="kart">
              <h2>Günlük ciro</h2>
              <table className="gunluk">
                <thead>
                  <tr>
                    <th>Gün</th>
                    <th className="sayi">Satış</th>
                    <th>Ciro</th>
                    <th className="sayi">Brüt kâr</th>
                  </tr>
                </thead>
                <tbody>
                  {[...rapor.gunler].reverse().map((g) => (
                    <tr key={g.gun}>
                      <td>{kisaTarih(g.gun)}</td>
                      <td className="sayi">{g.adet}</td>
                      <td>
                        <div className="cubuk-satir">
                          {g.ciroKurus > 0 && <span className="cubuk" style={{ width: `${(g.ciroKurus / enYuksek) * 60}%` }} />}
                          <span>{tl(g.ciroKurus)}</span>
                        </div>
                      </td>
                      <td className="sayi">{tl(g.brutKarKurus)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
            <section className="kart">
              <h2>En çok satan 20 ürün</h2>
              <UrunTablosu urunler={rapor.urunler} />
              <h2 className="ara-baslik">KDV dökümü</h2>
              <KdvTablosu o={rapor.toplam} />
            </section>
          </div>
        </>
      )}
    </>
  );
}

function StokBolumu() {
  const [rapor, setRapor] = useState<StokRaporu>();
  const [hata, setHata] = useState<Hata>();

  useEffect(() => {
    istek<StokRaporu>('/api/rapor/stok').then(setRapor, (e) => setHata(hataYap(e)));
  }, []);

  if (!rapor) return <HataKutusu hata={hata} />;
  const t = rapor.toplam;
  const gecmis = rapor.miad.filter((m) => m.kalanGun < 0);
  const kayipRiski = rapor.miad.reduce((s, m) => s + (m.maliyetKurus ?? 0), 0);

  return (
    <>
      <div className="ozet-kartlari">
        <div className="kart">
          <span className="soluk">Stok maliyeti (KDV hariç)</span>
          <strong>{tl(t.maliyetKurus)}</strong>
          <span className="soluk">{t.maliyetsizKutu ? `${t.maliyetsizKutu} kutunun maliyeti girilmemiş` : 'tüm partilerin maliyeti var'}</span>
        </div>
        <div className="kart">
          <span className="soluk">Raf değeri (satış fiyatıyla)</span>
          <strong>{tl(t.satisDegeriKurus)}</strong>
          <span className="soluk">
            {t.cesit} çeşit · {t.kutu} kutu
          </span>
        </div>
        <div className="kart">
          <span className="soluk">Miadı 90 gün içinde dolan</span>
          <strong>{rapor.miad.length - gecmis.length} parti</strong>
          <span className="soluk">maliyeti {tl(kayipRiski)}</span>
        </div>
        <div className="kart">
          <span className="soluk">Miadı geçmiş</span>
          <strong className={t.miadiGecmisKutu ? 'kirmizi-yazi' : ''}>{t.miadiGecmisKutu} kutu</strong>
          <span className="soluk">satılamaz; imha ya da iade edin</span>
        </div>
      </div>
      <div className="iki-sutun">
        <section className="kart">
          <h2>Miadı yaklaşanlar</h2>
          <table>
            <thead>
              <tr>
                <th>Ürün</th>
                <th>Parti</th>
                <th>SKT</th>
                <th className="sayi">Adet</th>
              </tr>
            </thead>
            <tbody>
              {rapor.miad.map((m) => (
                <tr key={`${m.barkod}|${m.partiNo}|${m.skt}`}>
                  <td>{m.ad}</td>
                  <td>{m.partiNo}</td>
                  <td>
                    {new Date(`${m.skt}T12:00:00`).toLocaleDateString('tr-TR')}{' '}
                    <span className={`rozet ${m.kalanGun < 0 ? 'kirmizi' : m.kalanGun <= 30 ? 'sari' : 'yesil'}`}>
                      {m.kalanGun < 0 ? `${-m.kalanGun} gün geçti` : `${m.kalanGun} gün`}
                    </span>
                  </td>
                  <td className="sayi">{m.miktar}</td>
                </tr>
              ))}
              {rapor.miad.length === 0 && (
                <tr>
                  <td colSpan={4} className="soluk">
                    Miadı 90 gün içinde dolan parti yok.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
        <section className="kart">
          <h2>Ürün bazında stok değeri</h2>
          <table>
            <thead>
              <tr>
                <th>Ürün</th>
                <th className="sayi">Adet</th>
                <th className="sayi">Maliyet</th>
                <th className="sayi">Raf değeri</th>
              </tr>
            </thead>
            <tbody>
              {rapor.kalemler.map((k) => (
                <tr key={k.barkod}>
                  <td>
                    {k.ad}
                    {k.maliyetsizKutu > 0 && <div className="soluk">{k.maliyetsizKutu} kutunun maliyeti yok</div>}
                  </td>
                  <td className="sayi">{k.miktar}</td>
                  <td className="sayi">{tl(k.maliyetKurus)}</td>
                  <td className="sayi">{tl(k.satisDegeriKurus)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </>
  );
}
