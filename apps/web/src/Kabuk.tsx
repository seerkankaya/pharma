import { useEffect, useState, type ReactNode } from 'react';
import { Ikon, type IkonAdi } from './Ikon';
import type { Oturum } from './Uygulama';

export interface Sayfa<S extends string> {
  id: S;
  ad: string;
  aciklama: string;
  ikon: IkonAdi;
}

type Tema = 'acik' | 'koyu';

/** Yan menü, üst çubuk ve tema. Sayfa içeriği children olarak gelir. */
export function Kabuk<S extends string>({
  oturum,
  sayfalar,
  secili,
  sec,
  cikis,
  children,
}: {
  oturum: Oturum;
  sayfalar: Sayfa<S>[];
  secili: S;
  sec: (s: S) => void;
  cikis: () => void;
  children: ReactNode;
}) {
  const [tema, setTema] = useState<Tema>(() => (document.documentElement.dataset.tema === 'koyu' ? 'koyu' : 'acik'));
  const [menuAcik, setMenuAcik] = useState(false);

  useEffect(() => {
    document.documentElement.dataset.tema = tema;
  }, [tema]);

  function temaDegistir() {
    const yeni = tema === 'koyu' ? 'acik' : 'koyu';
    setTema(yeni);
    try {
      localStorage.setItem('scalpiq-tema', yeni);
    } catch {
      // Gizli pencerede kayıt olmayabilir; tema yine de değişir.
    }
  }

  const sayfa = sayfalar.find((s) => s.id === secili) ?? sayfalar[0]!;
  const basHarfler = oturum.adSoyad
    .replace(/^Ecz\.\s*/i, '')
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toLocaleUpperCase('tr-TR');

  return (
    <div className={`kabuk ${menuAcik ? 'menu-acik' : ''}`}>
      <aside className="yan-menu">
        <div className="marka">
          <span className="logo" aria-hidden>
            <svg viewBox="0 0 32 32" width="28" height="28">
              <rect width="32" height="32" rx="9" fill="currentColor" />
              <path d="M16 8v16M8 16h16" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" />
            </svg>
          </span>
          <div>
            <strong>ScalpIQ</strong>
            <span>Eczane</span>
          </div>
          <button className="ikon-dugme menu-kapat" onClick={() => setMenuAcik(false)} aria-label="Menüyü kapat">
            <Ikon ad="kapat" />
          </button>
        </div>
        <nav className="menu">
          {sayfalar.map((s) => (
            <button
              key={s.id}
              className={s.id === secili ? 'aktif' : ''}
              aria-current={s.id === secili ? 'page' : undefined}
              onClick={() => {
                sec(s.id);
                setMenuAcik(false);
              }}
            >
              <Ikon ad={s.ikon} />
              {s.ad}
            </button>
          ))}
        </nav>
        <div className="kullanici">
          <span className="avatar">{basHarfler}</span>
          <div>
            <strong>{oturum.adSoyad}</strong>
            <span>{oturum.eczaneAd}</span>
          </div>
          <button className="ikon-dugme" onClick={cikis} aria-label="Çıkış" title="Çıkış">
            <Ikon ad="cikis" />
          </button>
        </div>
      </aside>
      <div className="perde" onClick={() => setMenuAcik(false)} />

      <div className="icerik">
        <header className="ust-cubuk">
          <button className="ikon-dugme menu-ac" onClick={() => setMenuAcik(true)} aria-label="Menüyü aç">
            <Ikon ad="menu" />
          </button>
          <div className="baslik">
            <h1>{sayfa.ad}</h1>
            <p>{sayfa.aciklama}</p>
          </div>
          <button className="ikon-dugme" onClick={temaDegistir} aria-label="Temayı değiştir" title={tema === 'koyu' ? 'Açık tema' : 'Koyu tema'}>
            <Ikon ad={tema === 'koyu' ? 'gunes' : 'ay'} />
          </button>
        </header>
        <main className="sayfa-icerik">{children}</main>
      </div>
    </div>
  );
}
