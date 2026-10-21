import { useEffect, useMemo, useState } from 'react';
import { ASGARI_GEREKCE_UZUNLUGU, gerekceAnahtari, type Bulgu, type GecmisVerilis, type KontrolSonucu, type Recete } from '@scalpiq/sut-motoru';
import { istek, IstekHatasi, OTURUM_DUSTU } from './api';
import { Alis } from './Alis';
import { DenetimKaydiSayfasi } from './DenetimKaydi';
import { ElleRecete } from './ElleRecete';
import { Giris } from './Giris';
import { GunSonu } from './GunSonu';
import { Kabuk, type Sayfa } from './Kabuk';
import { KuralKitapligi } from './KuralKitapligi';
import { Kullanicilar } from './Kullanicilar';
import { Musteriler } from './Musteriler';
import { Satis } from './Satis';
import { Stok } from './Stok';

export interface Oturum {
  id: string;
  eczaneId: string;
  eczaneAd: string;
  eposta: string;
  adSoyad: string;
  rol: 'eczaci' | 'calisan';
  kuralYetkisi: boolean;
}

interface Ornek {
  baslik: string;
  recete: Recete;
  gecmis?: GecmisVerilis[];
}

interface KlinikUyari {
  kuralId: string;
  siddet: 'kontrendike' | 'ciddi' | 'orta';
  mesaj: string;
  oneri?: string;
  kaynak: string;
  ilaclar: [string, string];
  gecmistenMi?: boolean;
  ornekKural?: boolean;
}

type Kontrol = KontrolSonucu & { kontrolId: string; klinikUyarilar?: KlinikUyari[] };

const SIDDET_ADI: Record<KlinikUyari['siddet'], string> = { kontrendike: 'Kontrendike', ciddi: 'Ciddi', orta: 'Orta' };

const DURUM_ADI = { yesil: 'Uygun', sari: 'Dikkat', kirmizi: 'Uygun değil' } as const;

type Sekme = 'kontrol' | 'satis' | 'stok' | 'alis' | 'musteriler' | 'gunsonu' | 'kurallar' | 'denetim' | 'kullanicilar';

const SAYFALAR: Sayfa<Sekme>[] = [
  { id: 'kontrol', ad: 'Reçete kontrol', ikon: 'recete', aciklama: "Reçete açılınca SUT'a göre kendiliğinden kontrol edilir; uygun değilse Medula'ya gönderilemez." },
  { id: 'satis', ad: 'Satış', ikon: 'satis', aciklama: 'Barkodu okutun; fiyat ürün kartından gelir, stok miadı en yakın partiden düşer.' },
  { id: 'stok', ad: 'Stok', ikon: 'stok', aciklama: 'Ürün kartları, partiler, son kullanma tarihleri ve stok uyarıları.' },
  { id: 'alis', ad: 'Alış ve sipariş', ikon: 'alis', aciklama: 'Ecza deposu faturaları stoğa parti olarak girer; kritik stoğa inen ürünler için sipariş önerisi.' },
  { id: 'musteriler', ad: 'Müşteriler ve veresiye', ikon: 'musteriler', aciklama: 'Veresiye hesapları: borç, tahsilat ve hesap dökümü.' },
  { id: 'gunsonu', ad: 'Gün sonu ve raporlar', ikon: 'rapor', aciklama: 'Kasa kapanışı, ciro, KDV ve kâr; stok değeri ve miadı yaklaşan partiler.' },
  { id: 'kurallar', ad: 'Kural kitaplığı', ikon: 'kurallar', aciklama: 'SUT ödeme koşulları. Kontrolde yalnızca onaylı kurallar kullanılır.' },
  { id: 'denetim', ad: 'Denetim kaydı', ikon: 'denetim', aciklama: "Medula'ya gönderilen her reçetenin kontrol izi; SGK itirazında kanıtınız." },
  { id: 'kullanicilar', ad: 'Kullanıcılar', ikon: 'kullanicilar', aciklama: 'Eczanenizde çalışanların hesapları.' },
];

const sekmeOku = (): Sekme => {
  const h = window.location.hash.replace('#/', '') as Sekme;
  return SAYFALAR.some((s) => s.id === h) ? h : 'kontrol';
};


export function Uygulama() {
  // undefined: henüz sorulmadı, null: oturum yok
  const [oturum, setOturum] = useState<Oturum | null>();
  const [sekme, setSekmeDurumu] = useState<Sekme>(sekmeOku);
  const setSekme = (s: Sekme) => {
    window.location.hash = `/${s}`;
    setSekmeDurumu(s);
  };

  useEffect(() => {
    const degisti = () => setSekmeDurumu(sekmeOku());
    window.addEventListener('hashchange', degisti);
    return () => window.removeEventListener('hashchange', degisti);
  }, []);

  useEffect(() => {
    istek<Oturum>('/api/ben').then(setOturum, () => setOturum(null));
    const dustu = () => setOturum(null);
    window.addEventListener(OTURUM_DUSTU, dustu);
    return () => window.removeEventListener(OTURUM_DUSTU, dustu);
  }, []);

  if (oturum === undefined) return null;
  if (oturum === null)
    return (
      <Giris girildi={setOturum} />
    );

  const sayfalar = SAYFALAR.filter((s) => s.id !== 'kullanicilar' || oturum.rol === 'eczaci');
  const gorunen = sayfalar.some((s) => s.id === sekme) ? sekme : 'kontrol';

  async function cikis() {
    await istek('/api/cikis', {}).catch(() => undefined);
    setOturum(null);
  }

  return (
    <Kabuk oturum={oturum} sayfalar={sayfalar} secili={gorunen} sec={setSekme} cikis={cikis}>
      {gorunen === 'kontrol' && <ReceteKontrol />}
      {gorunen === 'satis' && <Satis />}
      {gorunen === 'stok' && <Stok eczaci={oturum.rol === 'eczaci'} />}
      {gorunen === 'alis' && <Alis eczaci={oturum.rol === 'eczaci'} />}
      {gorunen === 'musteriler' && <Musteriler eczaci={oturum.rol === 'eczaci'} />}
      {gorunen === 'gunsonu' && <GunSonu eczaci={oturum.rol === 'eczaci'} />}
      {gorunen === 'kurallar' && <KuralKitapligi duzenleyebilir={oturum.kuralYetkisi} />}
      {gorunen === 'denetim' && <DenetimKaydiSayfasi />}
      {gorunen === 'kullanicilar' && <Kullanicilar benimId={oturum.id} />}
    </Kabuk>
  );
}

function ReceteKontrol() {
  const [ornekler, setOrnekler] = useState<Ornek[]>([]);
  /** -1: elle reçete girişi */
  const [secili, setSecili] = useState(0);
  const [elle, setElle] = useState<Ornek>();
  const [bugun, setBugun] = useState<string>();
  const [kontrol, setKontrol] = useState<Kontrol>();
  const [gerekceler, setGerekceler] = useState<Record<string, string>>({});
  const [mesaj, setMesaj] = useState<{ tur: 'basari' | 'hata'; metin: string; engeller?: string[] }>();
  const [mesgul, setMesgul] = useState(false);

  useEffect(() => {
    istek<Ornek[]>('/api/ornekler').then(setOrnekler, (e) => setMesaj({ tur: 'hata', metin: `API'ye ulaşılamadı: ${e.message}` }));
    istek<{ bugun: string }>('/api/bugun').then((b) => setBugun(b.bugun), () => setBugun(new Date().toISOString().slice(0, 10)));
  }, []);

  const elleMi = secili === -1;
  const ornek = elleMi ? elle : ornekler[secili];

  function sec(i: number) {
    setSecili(i);
    setMesaj(undefined);
    if (i === -1) setElle(undefined);
  }

  // Reçete açılır açılmaz SUT kontrolü kendiliğinden çalışır. Eczacı başka reçeteye geçerse
  // geç gelen eski sonuç ekrana yazılmaz.
  const [yenile, setYenile] = useState(0);
  useEffect(() => {
    if (!ornek) return;
    let iptal = false;
    setKontrol(undefined);
    setGerekceler({});
    setMesgul(true);
    istek<Kontrol>('/api/kontrol', { recete: ornek.recete, gecmis: ornek.gecmis })
      .then(
        (k) => !iptal && setKontrol(k),
        (e) => !iptal && setMesaj({ tur: 'hata', metin: (e as Error).message }),
      )
      .finally(() => !iptal && setMesgul(false));
    return () => {
      iptal = true;
    };
  }, [ornek, yenile]);

  async function gonder() {
    if (!kontrol) return;
    setMesgul(true);
    try {
      const { takipNo } = await istek<{ takipNo: string }>('/api/gonder', { kontrolId: kontrol.kontrolId, gerekceler });
      setMesaj({ tur: 'basari', metin: `Reçete Medula'ya gönderildi. Takip no: ${takipNo}` });
    } catch (e) {
      setMesaj({ tur: 'hata', metin: (e as Error).message, engeller: e instanceof IstekHatasi ? e.engeller : undefined });
    } finally {
      setMesgul(false);
    }
  }

  const kilit = useMemo(() => {
    if (!kontrol) return 'SUT kontrolü bekleniyor.';
    if (kontrol.bulgular.some((b) => b.seviye === 'kirmizi')) return 'Kırmızı uyarılar düzeltilmeden gönderilemez.';
    const eksik = kontrol.bulgular.filter((b) => (gerekceler[gerekceAnahtari(b)]?.trim().length ?? 0) < ASGARI_GEREKCE_UZUNLUGU).length;
    if (eksik) return `${eksik} uyarı için gerekçe yazın (en az ${ASGARI_GEREKCE_UZUNLUGU} karakter).`;
    return undefined;
  }, [kontrol, gerekceler]);

  return (
    <>
      <p className="sayfa-notu">"Örnek kural" etiketli uyarılar gerçek SUT hükmü değildir; canlı kullanımdan önce kural kitaplığı SUT'tan kodlanıp onaylanmalı.</p>
      <div className="duzen">
        <nav>
          <button className={elleMi ? 'secili' : ''} onClick={() => sec(-1)}>
            <strong>+ Elle reçete gir</strong>
            <span>Kendi reçetenizi girip kontrol edin</span>
          </button>
          <h2>Örnek reçeteler</h2>
          {ornekler.map((o, i) => (
            <button key={o.recete.no} className={i === secili ? 'secili' : ''} onClick={() => sec(i)}>
              <strong>{o.recete.no}</strong>
              <span>{o.baslik}</span>
            </button>
          ))}
        </nav>

        <main>
          {/* Form kontrol sonucu gösterilirken de açık kalır; düzenlemeye dönülünce girilenler kaybolmaz. */}
          {elleMi && bugun && (
            <div hidden={!!elle}>
              <ElleRecete
                bugun={bugun}
                kontrolEt={(recete) => {
                  setMesaj(undefined);
                  setElle({ baslik: 'Elle girilen reçete', recete });
                }}
              />
            </div>
          )}
          {elleMi && elle && (
            <div className="eylemler">
              <button onClick={() => setElle(undefined)}>← Reçeteyi düzenle</button>
            </div>
          )}
          {ornek && <ReceteKarti recete={ornek.recete} />}

          {ornek && !kontrol && mesgul && <p className="soluk">SUT kontrolü yapılıyor…</p>}

          {kontrol && (
            <section className={`sonuc ${kontrol.durum}`}>
              <h2>
                <span className={`rozet ${kontrol.durum}`}>{DURUM_ADI[kontrol.durum]}</span>
                {kontrol.bulgular.length === 0 ? 'Sorun bulunmadı' : `${kontrol.bulgular.length} uyarı`}
                <button className="sag" onClick={() => setYenile((n) => n + 1)} disabled={mesgul}>
                  Yeniden kontrol et
                </button>
              </h2>
              <p className="soluk">EK-4/A listesi: {kontrol.ek4aYayimTarihi} · Kontrol günü: {kontrol.kontrolTarihi}</p>
              {kontrol.bulgular.map((b) => (
                <BulguKarti
                  key={gerekceAnahtari(b) + b.mesaj}
                  bulgu={b}
                  gerekce={gerekceler[gerekceAnahtari(b)] ?? ''}
                  gerekceDegisti={(v) => setGerekceler((g) => ({ ...g, [gerekceAnahtari(b)]: v }))}
                />
              ))}
              {!!kontrol.klinikUyarilar?.length && (
                <div className="klinik-uyarilar">
                  <h3>İlaç etkileşimleri (gönderimi kilitlemez)</h3>
                  {kontrol.klinikUyarilar.map((u) => (
                    <div key={u.kuralId + u.ilaclar.join('|')} className={`bulgu ${u.siddet === 'orta' ? 'sari' : 'kirmizi'}`}>
                      <div className="bulgu-baslik">
                        <strong>{SIDDET_ADI[u.siddet]}</strong>
                        <span>
                          {u.ilaclar[0]} + {u.ilaclar[1]}
                          {u.gecmistenMi ? ' (biri hastanın yakın zamanda aldığı ilaç)' : ''}
                        </span>
                        {u.ornekKural && <span className="rozet sari">örnek kural</span>}
                      </div>
                      <p>{u.mesaj}</p>
                      {u.oneri && <p>{u.oneri}</p>}
                      <p className="soluk">Kaynak: {u.kaynak}</p>
                    </div>
                  ))}
                </div>
              )}
              <div className="eylemler">
                <button className="gonder" onClick={gonder} disabled={!!kilit || mesgul}>
                  {kilit ? '🔒 ' : ''}Medula'ya gönder
                </button>
                {kilit && <span className="soluk">{kilit}</span>}
              </div>
            </section>
          )}

          {mesaj && (
            <div className={`mesaj ${mesaj.tur}`}>
              {mesaj.metin}
              {mesaj.engeller && (
                <ul>
                  {mesaj.engeller.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </main>
      </div>
    </>
  );
}

function ReceteKarti({ recete }: { recete: Recete }) {
  return (
    <section className="kart">
      <h2>
        Reçete {recete.no} <span className="soluk">· {recete.tarih} · {recete.tur} reçete</span>
      </h2>
      <p>
        {recete.hekim.ad} ({recete.hekim.brans}) · Tanılar: {recete.tanilar.join(', ') || '—'}
      </p>
      <table>
        <thead>
          <tr>
            <th>İlaç</th>
            <th>Barkod</th>
            <th>Etken madde</th>
            <th>Adet</th>
            <th>Günlük doz</th>
          </tr>
        </thead>
        <tbody>
          {recete.kalemler.map((k) => (
            <tr key={k.barkod}>
              <td>{k.ad}</td>
              <td>{k.barkod}</td>
              <td>{k.etkenMadde}</td>
              <td>{k.adet}</td>
              <td>{k.gunlukDoz ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {recete.raporlar.map((r) => (
        <p key={r.no} className="soluk">
          Rapor {r.no}: {r.tur === 'saglik-kurulu' ? 'sağlık kurulu' : 'uzman hekim'} · {r.baslangic} – {r.bitis} · {r.duzenleyenBranslar.join(', ')} ·
          tanılar {r.tanilar.join(', ')}
        </p>
      ))}
      {recete.raporlar.length === 0 && <p className="soluk">Raporsuz reçete</p>}
    </section>
  );
}

function BulguKarti({ bulgu, gerekce, gerekceDegisti }: { bulgu: Bulgu; gerekce: string; gerekceDegisti: (v: string) => void }) {
  return (
    <div className={`bulgu ${bulgu.seviye}`}>
      <div className="bulgu-baslik">
        <span className={`rozet ${bulgu.seviye}`}>{bulgu.seviye === 'kirmizi' ? 'Uygun değil' : 'Dikkat'}</span>
        <code>{bulgu.kuralId}</code>
        {bulgu.ornekKural && <span className="ornek">örnek kural</span>}
      </div>
      <p>{bulgu.mesaj}</p>
      <ul className="kaynaklar">
        {bulgu.kaynaklar.map((k, i) => (
          <li key={i}>
            Kaynak: <strong>{k.tur}</strong>
            {k.madde && ` madde ${k.madde}`} · {k.aciklama}
            {k.resmiGazete && ` · Resmî Gazete ${k.resmiGazete.tarih}${k.resmiGazete.sayi ? ` / ${k.resmiGazete.sayi}` : ''}`}
            {k.url && (
              <>
                {' · '}
                <a href={k.url} target="_blank" rel="noreferrer">
                  metin
                </a>
              </>
            )}
          </li>
        ))}
      </ul>
      {bulgu.seviye === 'sari' && (
        <textarea placeholder="Gerekçe (denetim kaydına yazılır)" value={gerekce} onChange={(e) => gerekceDegisti(e.target.value)} />
      )}
    </div>
  );
}
