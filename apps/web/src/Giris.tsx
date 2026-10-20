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
    <div className="sayfa giris">
      <form className="kart form" onSubmit={gonder}>
        <h1>ScalpIQ</h1>
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
