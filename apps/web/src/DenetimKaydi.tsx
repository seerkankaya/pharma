import { useEffect, useState } from 'react';
import type { Bulgu, Durum, Gerekceler } from '@scalpiq/sut-motoru';
import { istek } from './api';

interface DenetimKaydi {
  zaman: string;
  receteNo: string;
  durum: Durum;
  bulgular: Pick<Bulgu, 'kuralId' | 'seviye' | 'mesaj' | 'barkod' | 'ilacKuraliId'>[];
  gerekceler: Gerekceler;
  ek4aYayimTarihi: string;
  takipNo?: string;
}

const DURUM_ADI = { yesil: 'Uygun', sari: 'Dikkat', kirmizi: 'Uygun değil' } as const;

export function DenetimKaydiSayfasi() {
  const [kayitlar, setKayitlar] = useState<DenetimKaydi[]>();
  const [hata, setHata] = useState<string>();

  useEffect(() => {
    istek<DenetimKaydi[]>('/api/denetim').then(setKayitlar, (e) => setHata((e as Error).message));
  }, []);

  if (hata) return <div className="mesaj hata">{hata}</div>;
  if (!kayitlar) return null;

  return (
    <>
      <p className="soluk">
        Medula'ya gönderilen her reçetenin kontrol izi. SGK itirazında hangi uyarının görüldüğünü ve hangi gerekçeyle geçildiğini gösterir.
      </p>
      {kayitlar.length === 0 && <p>Henüz gönderilmiş reçete yok.</p>}
      {kayitlar.map((k) => (
        <section key={`${k.zaman}-${k.receteNo}`} className="kart">
          <h2>
            <span className={`rozet ${k.durum}`}>{DURUM_ADI[k.durum]}</span>
            Reçete {k.receteNo}
            <span className="soluk">
              · {new Date(k.zaman).toLocaleString('tr-TR')} · Takip no {k.takipNo ?? '—'} · EK-4/A {k.ek4aYayimTarihi}
            </span>
          </h2>
          {k.bulgular.length === 0 && <p className="soluk">Uyarı yoktu.</p>}
          <ul>
            {k.bulgular.map((b) => {
              const anahtar = b.barkod ? `${b.kuralId}:${b.barkod}` : b.kuralId;
              return (
                <li key={anahtar + b.mesaj}>
                  {b.mesaj}
                  {k.gerekceler[anahtar] && (
                    <div>
                      <strong>Gerekçe:</strong> {k.gerekceler[anahtar]}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </>
  );
}
