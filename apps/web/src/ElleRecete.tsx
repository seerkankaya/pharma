import { useEffect, useState, type FormEvent } from 'react';
import type { Ek4aKaydi, IlacKurali, Rapor, Recete, ReceteKalemi, ReceteTuru } from '@scalpiq/sut-motoru';
import { istek } from './api';

// Medula bağlantısı gelene kadar reçeteyi elle girip SUT kontrolünü denemek için form.
// Barkod girilince ilacın adı güncel EK-4/A listesinden gelir; etken madde kural kitaplığındaki adlardan seçilir.

const BRANSLAR = [
  'Aile Hekimliği',
  'Acil Tıp',
  'Beyin ve Sinir Cerrahisi',
  'Çocuk Sağlığı ve Hastalıkları',
  'Endokrinoloji ve Metabolizma Hastalıkları',
  'Fiziksel Tıp ve Rehabilitasyon',
  'Geriatri',
  'Göğüs Hastalıkları',
  'İç Hastalıkları',
  'Kadın Hastalıkları ve Doğum',
  'Kalp ve Damar Cerrahisi',
  'Kardiyoloji',
  'Nöroloji',
  'Ortopedi ve Travmatoloji',
  'Psikiyatri',
  'Radyoloji',
  'Romatoloji',
  'Tıbbi Onkoloji',
];

interface KalemSatiri {
  barkod: string;
  ad: string;
  etkenMadde: string;
  adet: string;
  gunlukDoz: string;
  kutuIcerik: string;
}

interface RaporFormu {
  var: boolean;
  no: string;
  tur: Rapor['tur'];
  baslangic: string;
  bitis: string;
  branslar: string;
  tanilar: string;
}

const bosKalem = (): KalemSatiri => ({ barkod: '', ad: '', etkenMadde: '', adet: '1', gunlukDoz: '', kutuIcerik: '' });

const virgulle = (s: string) =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

const yilSonra = (t: string) => {
  const d = new Date(`${t}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() + 1);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

export function ElleRecete({ bugun, kontrolEt }: { bugun: string; kontrolEt: (r: Recete) => void }) {
  const [tarih, setTarih] = useState(bugun);
  const [tur, setTur] = useState<ReceteTuru>('normal');
  const [hekimAd, setHekimAd] = useState('');
  const [brans, setBrans] = useState('');
  const [tanilar, setTanilar] = useState('');
  const [kalemler, setKalemler] = useState<KalemSatiri[]>([bosKalem()]);
  const [rapor, setRapor] = useState<RaporFormu>({ var: false, no: '', tur: 'uzman', baslangic: bugun, bitis: yilSonra(bugun), branslar: '', tanilar: '' });
  const [etkenler, setEtkenler] = useState<string[]>([]);
  const [hata, setHata] = useState<string>();

  useEffect(() => {
    istek<IlacKurali[]>('/api/kurallar').then(
      (k) => setEtkenler([...new Set(k.map((x) => x.etkenMadde))].sort((a, b) => a.localeCompare(b, 'tr'))),
      () => undefined,
    );
  }, []);

  const kalemDegistir = (i: number, alan: keyof KalemSatiri, deger: string) =>
    setKalemler((ks) => ks.map((k, j) => (j === i ? { ...k, [alan]: deger } : k)));

  // Barkod tamamlanınca adı EK-4/A'dan getirir; listede yoksa ad boş kalır ve kontrol bunu zaten kırmızı gösterir.
  async function barkodBul(i: number) {
    const barkod = kalemler[i]?.barkod.trim();
    if (!barkod || !/^\d{8,14}$/.test(barkod)) return;
    try {
      const [k] = await istek<Ek4aKaydi[]>(`/api/ek4a/ara?q=${barkod}`);
      if (k?.barkod === barkod) setKalemler((ks) => ks.map((x, j) => (j === i && !x.ad ? { ...x, ad: k.ad } : x)));
    } catch {
      // Arama yapılamazsa ad elle girilir.
    }
  }

  function gonder(e: FormEvent) {
    e.preventDefault();
    const dolu = kalemler.filter((k) => k.barkod.trim());
    if (!brans.trim()) return setHata('Hekimin branşını girin');
    if (dolu.length === 0) return setHata('En az bir ilaç girin');
    const eksik = dolu.find((k) => !k.etkenMadde.trim() || !(Number(k.adet) > 0));
    if (eksik) return setHata(`${eksik.barkod} için etken madde ve adet girin`);
    setHata(undefined);
    const sayi = (s: string) => (s.trim() && Number(s) > 0 ? Number(s) : undefined);
    const receteKalemleri: ReceteKalemi[] = dolu.map((k) => ({
      barkod: k.barkod.trim(),
      ad: k.ad.trim() || k.barkod.trim(),
      etkenMadde: k.etkenMadde.trim(),
      adet: Number(k.adet),
      ...(sayi(k.gunlukDoz) ? { gunlukDoz: sayi(k.gunlukDoz) } : {}),
      ...(sayi(k.kutuIcerik) ? { kutuIcerik: sayi(k.kutuIcerik) } : {}),
    }));
    const recete: Recete = {
      no: `ELLE-${Date.now().toString(36).toUpperCase()}`,
      tarih,
      tur,
      hekim: { ad: hekimAd.trim() || 'Belirtilmedi', brans: brans.trim() },
      tanilar: virgulle(tanilar.toUpperCase()),
      kalemler: receteKalemleri,
      raporlar: rapor.var
        ? [
            {
              no: rapor.no.trim() || 'RAPOR-1',
              tur: rapor.tur,
              baslangic: rapor.baslangic,
              bitis: rapor.bitis,
              duzenleyenBranslar: virgulle(rapor.branslar),
              tanilar: virgulle(rapor.tanilar.toUpperCase()),
              ilaclar: [...new Set(receteKalemleri.map((k) => k.etkenMadde))].map((etkenMadde) => ({ etkenMadde })),
            },
          ]
        : [],
    };
    kontrolEt(recete);
  }

  return (
    <form className="kart form elle-recete" onSubmit={gonder}>
      <h2>Elle reçete gir</h2>
      <p className="soluk">Medula bağlantısı gelene kadar reçeteyi buradan girip SUT kontrolünü deneyebilirsiniz.</p>
      <datalist id="branslar">
        {BRANSLAR.map((b) => (
          <option key={b} value={b} />
        ))}
      </datalist>
      <datalist id="etken-maddeler">
        {etkenler.map((e) => (
          <option key={e} value={e} />
        ))}
      </datalist>

      <fieldset>
        <label>
          Reçete tarihi
          <input type="date" value={tarih} max={bugun} onChange={(e) => setTarih(e.target.value)} required />
        </label>
        <label>
          Reçete türü
          <select value={tur} onChange={(e) => setTur(e.target.value as ReceteTuru)}>
            <option value="normal">Normal</option>
            <option value="kirmizi">Kırmızı</option>
            <option value="yesil">Yeşil</option>
            <option value="mor">Mor</option>
            <option value="turuncu">Turuncu</option>
          </select>
        </label>
        <label>
          Hekim adı
          <input value={hekimAd} onChange={(e) => setHekimAd(e.target.value)} placeholder="isteğe bağlı" />
        </label>
        <label>
          Hekim branşı
          <input list="branslar" value={brans} onChange={(e) => setBrans(e.target.value)} placeholder="Örn. Aile Hekimliği" required />
        </label>
        <label className="genis">
          Reçetedeki tanılar (ICD-10)
          <input value={tanilar} onChange={(e) => setTanilar(e.target.value)} placeholder="Örn. E78, I25 (virgülle)" />
        </label>
      </fieldset>

      <h3>İlaçlar</h3>
      <div className="elle-tablo">
        <table className="elle-kalemler">
          <thead>
            <tr>
              <th>Barkod</th>
              <th>İlaç adı</th>
              <th>Etken madde</th>
              <th>Kutu</th>
              <th>Günlük doz</th>
              <th>Kutu içeriği</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {kalemler.map((k, i) => (
              <tr key={i}>
                <td>
                  <input
                    inputMode="numeric"
                    value={k.barkod}
                    onChange={(e) => kalemDegistir(i, 'barkod', e.target.value.replace(/\D/g, ''))}
                    onBlur={() => void barkodBul(i)}
                    placeholder="869..."
                    aria-label="Barkod"
                  />
                </td>
                <td>
                  <input value={k.ad} onChange={(e) => kalemDegistir(i, 'ad', e.target.value)} placeholder="EK-4/A'dan gelir" aria-label="İlaç adı" />
                </td>
                <td>
                  <input
                    list="etken-maddeler"
                    value={k.etkenMadde}
                    onChange={(e) => kalemDegistir(i, 'etkenMadde', e.target.value.toLocaleUpperCase('tr-TR'))}
                    placeholder="Örn. ATORVASTATIN"
                    aria-label="Etken madde"
                  />
                </td>
                <td>
                  <input type="number" min="1" value={k.adet} onChange={(e) => kalemDegistir(i, 'adet', e.target.value)} aria-label="Kutu" />
                </td>
                <td>
                  <input type="number" min="0" step="any" value={k.gunlukDoz} onChange={(e) => kalemDegistir(i, 'gunlukDoz', e.target.value)} aria-label="Günlük doz" />
                </td>
                <td>
                  <input type="number" min="0" value={k.kutuIcerik} onChange={(e) => kalemDegistir(i, 'kutuIcerik', e.target.value)} aria-label="Kutu içeriği" />
                </td>
                <td>
                  {kalemler.length > 1 && (
                    <button type="button" onClick={() => setKalemler((ks) => ks.filter((_, j) => j !== i))} aria-label="İlacı çıkar">
                      ✕
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button type="button" onClick={() => setKalemler((ks) => [...ks, bosKalem()])}>
        + İlaç ekle
      </button>

      <h3>
        <label className="kutu">
          <input type="checkbox" checked={rapor.var} onChange={(e) => setRapor((r) => ({ ...r, var: e.target.checked }))} />
          Reçetede rapor var
        </label>
      </h3>
      {rapor.var && (
        <fieldset>
          <label>
            Rapor no
            <input value={rapor.no} onChange={(e) => setRapor((r) => ({ ...r, no: e.target.value }))} placeholder="isteğe bağlı" />
          </label>
          <label>
            Rapor türü
            <select value={rapor.tur} onChange={(e) => setRapor((r) => ({ ...r, tur: e.target.value as Rapor['tur'] }))}>
              <option value="uzman">Uzman hekim raporu</option>
              <option value="saglik-kurulu">Sağlık kurulu raporu</option>
            </select>
          </label>
          <label>
            Başlangıç
            <input type="date" value={rapor.baslangic} onChange={(e) => setRapor((r) => ({ ...r, baslangic: e.target.value }))} required />
          </label>
          <label>
            Bitiş
            <input type="date" value={rapor.bitis} onChange={(e) => setRapor((r) => ({ ...r, bitis: e.target.value }))} required />
          </label>
          <label className="genis">
            Raporu düzenleyen branşlar
            <input
              list="branslar"
              value={rapor.branslar}
              onChange={(e) => setRapor((r) => ({ ...r, branslar: e.target.value }))}
              placeholder="Örn. Kardiyoloji, İç Hastalıkları (virgülle)"
            />
          </label>
          <label className="genis">
            Rapordaki tanılar (ICD-10)
            <input value={rapor.tanilar} onChange={(e) => setRapor((r) => ({ ...r, tanilar: e.target.value }))} placeholder="Örn. E78 (virgülle)" />
          </label>
          <p className="soluk elle-not">Rapor, reçetedeki ilaçların etken maddelerini kapsıyor sayılır.</p>
        </fieldset>
      )}

      {hata && <div className="mesaj hata">{hata}</div>}
      <div className="eylemler">
        <button className="birincil" type="submit">
          SUT kontrolü yap
        </button>
      </div>
    </form>
  );
}
