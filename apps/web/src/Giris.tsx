import { useState, type FormEvent } from 'react';
import { istek } from './api';
import type { Oturum } from './Uygulama';

export function Giris({ girildi }: { girildi: (o: Oturum) => void }) {
  const [eposta, setEposta] = useState('');
  const [parola, setParola] = useState('');
  const [hata, setHata] = useState<string>();
  const [mesgul, setMesgul] = useState(false);

  async function gonder(e: FormEvent) {
    e.preventDefault();
    setMesgul(true);
    setHata(undefined);
    try {
      girildi(await istek<Oturum>('/api/giris', { eposta, parola }));
    } catch (e) {
      setHata((e as Error).message);
    } finally {
      setMesgul(false);
    }
  }

  return (
    <div className="giris">
      <form className="kart form" onSubmit={gonder}>
        <h1>
          <svg viewBox="0 0 32 32" width="32" height="32" aria-hidden>
            <rect width="32" height="32" rx="9" fill="currentColor" />
            <path d="M16 8v16M8 16h16" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" />
          </svg>
          ScalpIQ
        </h1>
        <p className="soluk">Eczane hesabınızla oturum açın.</p>
        <label>
          E-posta
          <input type="email" autoComplete="username" required value={eposta} onChange={(e) => setEposta(e.target.value)} />
        </label>
        <label>
          Parola
          <input type="password" autoComplete="current-password" required value={parola} onChange={(e) => setParola(e.target.value)} />
        </label>
        {hata && <div className="mesaj hata">{hata}</div>}
        <button className="birincil" type="submit" disabled={mesgul}>
          Oturum aç
        </button>
      </form>
    </div>
  );
}
