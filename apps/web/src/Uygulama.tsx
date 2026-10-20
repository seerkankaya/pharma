import { useEffect, useMemo, useState } from 'react';
import { ASGARI_GEREKCE_UZUNLUGU, gerekceAnahtari, type Bulgu, type GecmisVerilis, type KontrolSonucu, type Recete } from '@scalpiq/sut-motoru';
import { istek, IstekHatasi, OTURUM_DUSTU } from './api';
import { DenetimKaydiSayfasi } from './DenetimKaydi';
import { Giris } from './Giris';
import { KuralKitapligi } from './KuralKitapligi';
import { Kullanicilar } from './Kullanicilar';
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

type Kontrol = KontrolSonucu & { kontrolId: string };

const DURUM_ADI = { yesil: 'Uygun', sari: 'Dikkat', kirmizi: 'Uygun değil' } as const;

const SEKMELER = {
  kontrol: 'Reçete kontrol',
  satis: 'Satış',
  stok: 'Stok',
  kurallar: 'Kural kitaplığı',
  denetim: 'Denetim kaydı',
  kullanicilar: 'Kullanıcılar',
} as const;
type Sekme = keyof typeof SEKMELER;

export function Uygulama() {
  // undefined: henüz sorulmadı, null: oturum yok
  const [oturum, setOturum] = useState<Oturum | null>();
  const [sekme, setSekme] = useState<Sekme>('kontrol');

  useEffect(() => {
    istek<Oturum>('/api/ben').then(setOturum, () => setOturum(null));
    const dustu = () => setOturum(null);
    window.addEventListener(OTURUM_DUSTU, dustu);
    return () => window.removeEventListener(OTURUM_DUSTU, dustu);
  }, []);

  if (oturum === undefined) return null;
  if (oturum === null)
    return (
      <Giris
        girildi={(o) => {
          setSekme('kontrol');
          setOturum(o);
        }}
      />
    );

  const sekmeler = (Object.keys(SEKMELER) as Sekme[]).filter((s) => s !== 'kullanicilar' || oturum.rol === 'eczaci');

  async function cikis() {
    await istek('/api/cikis', {}).catch(() => undefined);
    setOturum(null);
  }

  return (
    <div className="sayfa">
      <header>
        <h1>ScalpIQ</h1>
        <div className="sekmeler">
          {sekmeler.map((s) => (
            <button key={s} className={s === sekme ? 'secili' : ''} onClick={() => setSekme(s)}>
              {SEKMELER[s]}
            </button>
          ))}
        </div>
        <div className="hesap">
          <span>
            {oturum.adSoyad} <span className="soluk">· {oturum.eczaneAd}</span>
          </span>
          <button onClick={cikis}>Çıkış</button>
        </div>
      </header>
      {sekme === 'kontrol' && <ReceteKontrol />}
      {sekme === 'satis' && <Satis />}
      {sekme === 'stok' && <Stok eczaci={oturum.rol === 'eczaci'} />}
      {sekme === 'kurallar' && <KuralKitapligi duzenleyebilir={oturum.kuralYetkisi} />}
      {sekme === 'denetim' && <DenetimKaydiSayfasi />}
      {sekme === 'kullanicilar' && <Kullanicilar benimId={oturum.id} />}
    </div>
  );
}

function ReceteKontrol() {
  const [ornekler, setOrnekler] = useState<Ornek[]>([]);
  const [secili, setSecili] = useState(0);
  const [kontrol, setKontrol] = useState<Kontrol>();
  const [gerekceler, setGerekceler] = useState<Record<string, string>>({});
  const [mesaj, setMesaj] = useState<{ tur: 'basari' | 'hata'; metin: string; engeller?: string[] }>();
  const [mesgul, setMesgul] = useState(false);

  useEffect(() => {
    istek<Ornek[]>('/api/ornekler').then(setOrnekler, (e) => setMesaj({ tur: 'hata', metin: `API'ye ulaşılamadı: ${e.message}` }));
  }, []);

  const ornek = ornekler[secili];

  function sec(i: number) {
    setSecili(i);
    setMesaj(undefined);
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
      <p className="soluk">Reçete açıldığı anda SUT'a göre kendiliğinden kontrol edilir; sonuç uygun değilse Medula'ya gönderilemez. "Örnek kural" etiketli uyarılar gerçek SUT hükmü değildir.</p>
      <div className="duzen">
        <nav>
          <h2>Örnek reçeteler</h2>
          {ornekler.map((o, i) => (
            <button key={o.recete.no} className={i === secili ? 'secili' : ''} onClick={() => sec(i)}>
              <strong>{o.recete.no}</strong>
              <span>{o.baslik}</span>
            </button>
          ))}
        </nav>

        <main>
          {ornek && <ReceteKarti recete={ornek.recete} />}

          <div className="eylemler">
            {ornek && !kontrol && mesgul && <span className="soluk">SUT kontrolü yapılıyor…</span>}
            {kontrol && (
              <button onClick={() => setYenile((n) => n + 1)} disabled={mesgul}>
                Yeniden kontrol et
              </button>
            )}
          </div>

          {kontrol && (
            <section className={`sonuc ${kontrol.durum}`}>
              <h2>
                <span className={`rozet ${kontrol.durum}`}>{DURUM_ADI[kontrol.durum]}</span>
                {kontrol.bulgular.length === 0 ? 'Sorun bulunmadı' : `${kontrol.bulgular.length} uyarı`}
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
