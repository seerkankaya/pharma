import { useEffect, useMemo, useState } from 'react';
import { ASGARI_GEREKCE_UZUNLUGU, gerekceAnahtari, type Bulgu, type GecmisVerilis, type KontrolSonucu, type Recete } from '@scalpiq/sut-motoru';

interface Ornek {
  baslik: string;
  recete: Recete;
  gecmis?: GecmisVerilis[];
}

type Kontrol = KontrolSonucu & { kontrolId: string };

const DURUM_ADI = { yesil: 'Uygun', sari: 'Dikkat', kirmizi: 'Uygun değil' } as const;

async function istek<T>(url: string, govde?: unknown): Promise<T> {
  const yanit = await fetch(url, govde === undefined ? undefined : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(govde) });
  const veri = await yanit.json();
  if (!yanit.ok) throw Object.assign(new Error(veri.hata ?? 'İstek başarısız'), { engeller: veri.engeller as string[] | undefined });
  return veri as T;
}

export function Uygulama() {
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
    setKontrol(undefined);
    setGerekceler({});
    setMesaj(undefined);
  }

  async function kontrolEt() {
    if (!ornek) return;
    setMesgul(true);
    setMesaj(undefined);
    setGerekceler({});
    try {
      setKontrol(await istek<Kontrol>('/api/kontrol', { recete: ornek.recete, gecmis: ornek.gecmis }));
    } catch (e) {
      setMesaj({ tur: 'hata', metin: (e as Error).message });
    } finally {
      setMesgul(false);
    }
  }

  async function gonder() {
    if (!kontrol) return;
    setMesgul(true);
    try {
      const { takipNo } = await istek<{ takipNo: string }>('/api/gonder', { kontrolId: kontrol.kontrolId, gerekceler });
      setMesaj({ tur: 'basari', metin: `Reçete Medula'ya gönderildi. Takip no: ${takipNo}` });
    } catch (e) {
      setMesaj({ tur: 'hata', metin: (e as Error).message, engeller: (e as { engeller?: string[] }).engeller });
    } finally {
      setMesgul(false);
    }
  }

  const kilit = useMemo(() => {
    if (!kontrol) return 'Önce reçeteyi kontrol edin.';
    if (kontrol.bulgular.some((b) => b.seviye === 'kirmizi')) return 'Kırmızı uyarılar düzeltilmeden gönderilemez.';
    const eksik = kontrol.bulgular.filter((b) => (gerekceler[gerekceAnahtari(b)]?.trim().length ?? 0) < ASGARI_GEREKCE_UZUNLUGU).length;
    if (eksik) return `${eksik} uyarı için gerekçe yazın (en az ${ASGARI_GEREKCE_UZUNLUGU} karakter).`;
    return undefined;
  }, [kontrol, gerekceler]);

  return (
    <div className="sayfa">
      <header>
        <h1>ScalpIQ Reçete Kontrol</h1>
        <p className="soluk">Reçete Medula'ya gitmeden önce SUT'a göre kontrol edilir. Örnek kurallarla çalışıyor; gerçek SUT hükmü değildir.</p>
      </header>

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
            <button className="birincil" onClick={kontrolEt} disabled={!ornek || mesgul}>
              SUT kontrolü yap
            </button>
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
    </div>
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
