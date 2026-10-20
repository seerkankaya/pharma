import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { IlacKurali, Kaynak, RaporTuru, ReceteTuru } from '@scalpiq/sut-motoru';
import { istek, IstekHatasi } from './api';

type KuralDurumu = 'ornek' | 'taslak' | 'onayli' | 'kapali';

function durum(k: IlacKurali): KuralDurumu {
  if (k.ornek) return 'ornek';
  if (!k.onay) return 'taslak';
  return k.gecerlilik.bitis ? 'kapali' : 'onayli';
}

const RECETE_TURU_ADI: Record<ReceteTuru, string> = { normal: 'normal', kirmizi: 'kırmızı', yesil: 'yeşil', mor: 'mor', turuncu: 'turuncu' };

const DURUM_ADI: Record<KuralDurumu, string> = { ornek: 'Örnek', taslak: 'Taslak', onayli: 'Onaylı', kapali: 'Kapalı' };

const liste = (s: string) =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

const BOS_FORM = {
  id: '',
  etkenMadde: '',
  aciklama: '',
  kaynakTur: 'SUT' as Kaynak['tur'],
  madde: '',
  kaynakAciklama: '',
  rgTarih: '',
  rgSayi: '',
  url: '',
  baslangic: '',
  raporGerekli: false,
  raporTuru: '' as RaporTuru | '',
  raporBranslari: '',
  receteBranslari: '',
  tanilar: '',
  maksDoz: '',
  maksGun: '',
  receteTuru: '' as ReceteTuru | '',
};

function formdanKural(f: typeof BOS_FORM): IlacKurali {
  const sayi = (s: string) => (s.trim() ? Number(s) : undefined);
  const dizi = (s: string) => (liste(s).length ? liste(s) : undefined);
  return {
    id: f.id.trim(),
    etkenMadde: f.etkenMadde.trim(),
    aciklama: f.aciklama.trim(),
    kaynak: {
      tur: f.kaynakTur,
      madde: f.madde.trim() || undefined,
      aciklama: f.kaynakAciklama.trim(),
      resmiGazete: f.rgTarih ? { tarih: f.rgTarih, sayi: f.rgSayi.trim() || undefined } : undefined,
      url: f.url.trim() || undefined,
    },
    gecerlilik: { baslangic: f.baslangic },
    raporGerekli: f.raporGerekli || undefined,
    raporTuru: f.raporTuru || undefined,
    raporDuzenleyenBranslar: dizi(f.raporBranslari),
    receteEdenBranslar: dizi(f.receteBranslari),
    izinliTanilar: dizi(f.tanilar.toUpperCase()),
    maksGunlukDoz: sayi(f.maksDoz),
    maksTedaviGunu: sayi(f.maksGun),
    receteTuru: f.receteTuru || undefined,
  };
}

function kosullar(k: IlacKurali): string {
  const p: string[] = [];
  if (k.raporGerekli) p.push(`${k.raporTuru === 'saglik-kurulu' ? 'sağlık kurulu' : k.raporTuru === 'uzman' ? 'uzman hekim' : ''} raporu`.trim());
  if (k.raporDuzenleyenBranslar?.length) p.push(`rapor: ${k.raporDuzenleyenBranslar.join(', ')}`);
  if (k.receteEdenBranslar?.length) p.push(`reçete: ${k.receteEdenBranslar.join(', ')}`);
  if (k.izinliTanilar?.length) p.push(`tanı: ${k.izinliTanilar.join(', ')}`);
  if (k.maksGunlukDoz) p.push(`en fazla ${k.maksGunlukDoz}/gün`);
  if (k.maksTedaviGunu) p.push(`en fazla ${k.maksTedaviGunu} gün`);
  if (k.receteTuru) p.push(`${RECETE_TURU_ADI[k.receteTuru]} reçete`);
  return p.join(' · ') || '—';
}

export function KuralKitapligi() {
  const [kurallar, setKurallar] = useState<IlacKurali[]>([]);
  const [form, setForm] = useState(BOS_FORM);
  const [formAcik, setFormAcik] = useState(false);
  const [hata, setHata] = useState<{ metin: string; ayrinti?: string[] }>();

  const yukle = useCallback(() => istek<IlacKurali[]>('/api/kurallar').then(setKurallar), []);
  useEffect(() => {
    yukle().catch((e) => setHata({ metin: (e as Error).message }));
  }, [yukle]);

  async function islem(f: () => Promise<unknown>) {
    setHata(undefined);
    try {
      await f();
      await yukle();
      return true;
    } catch (e) {
      setHata({ metin: (e as Error).message, ayrinti: e instanceof IstekHatasi ? e.hatalar : undefined });
      return false;
    }
  }

  async function kaydet(e: FormEvent) {
    e.preventDefault();
    if (await islem(() => istek('/api/kurallar', formdanKural(form)))) {
      setForm(BOS_FORM);
      setFormAcik(false);
    }
  }

  function onayla(k: IlacKurali) {
    const onaylayan = window.prompt(`${k.id} kuralını SUT metniyle karşılaştırdınız mı? Onaylayan eczacının adı:`);
    if (onaylayan) void islem(() => istek(`/api/kurallar/${encodeURIComponent(k.id)}/onayla`, { onaylayan }));
  }

  function kapat(k: IlacKurali) {
    const bitis = window.prompt(`${k.id} kuralı hangi tarihe kadar geçerli? (YYYY-AA-GG)`);
    if (bitis) void islem(() => istek(`/api/kurallar/${encodeURIComponent(k.id)}/kapat`, { bitis }));
  }

  function sil(k: IlacKurali) {
    if (window.confirm(`${k.id} taslağı silinsin mi?`)) void islem(() => istek(`/api/kurallar/${encodeURIComponent(k.id)}`, undefined, 'DELETE'));
  }

  const alan = (ad: keyof typeof BOS_FORM) => ({
    value: String(form[ad]),
    onChange: (e: { target: { value: string } }) => setForm((f) => ({ ...f, [ad]: e.target.value })),
  });

  return (
    <>
      <p className="soluk">
        Kontrolde yalnızca onaylı kurallar kullanılır. SUT değişince eski kuralın geçerliliğini kapatın ve yeni sürümü taslak olarak ekleyip onaylayın.
        Onaylı kural düzenlenemez ve silinemez.
      </p>
      <div className="eylemler">
        <button className="birincil" onClick={() => setFormAcik((a) => !a)}>
          {formAcik ? 'Formu kapat' : 'Yeni kural ekle'}
        </button>
      </div>

      {formAcik && (
        <form className="kart form" onSubmit={kaydet}>
          <fieldset>
            <legend>Kural</legend>
            <label>Kimlik<input required placeholder="SUT-4.2.X-MADDE-1" {...alan('id')} /></label>
            <label>Etken madde<input required {...alan('etkenMadde')} /></label>
            <label className="genis">Açıklama<input required placeholder="Ödeme koşulunun kısa özeti" {...alan('aciklama')} /></label>
            <label>Geçerlilik başlangıcı<input required type="date" {...alan('baslangic')} /></label>
          </fieldset>
          <fieldset>
            <legend>Kaynak</legend>
            <label>
              Tür
              <select {...alan('kaynakTur')}>
                <option>SUT</option>
                <option>Mevzuat</option>
                <option>Protokol</option>
              </select>
            </label>
            <label>Madde no<input placeholder="4.2.X" {...alan('madde')} /></label>
            <label className="genis">Kaynak açıklaması<input required placeholder="Örn. SUT 4.2.X, … kullanım ilkeleri" {...alan('kaynakAciklama')} /></label>
            <label>Resmî Gazete tarihi<input type="date" {...alan('rgTarih')} /></label>
            <label>Resmî Gazete sayısı<input {...alan('rgSayi')} /></label>
            <label className="genis">Metin bağlantısı<input type="url" {...alan('url')} /></label>
          </fieldset>
          <fieldset>
            <legend>Koşullar</legend>
            <label className="kutu">
              <input type="checkbox" checked={form.raporGerekli} onChange={(e) => setForm((f) => ({ ...f, raporGerekli: e.target.checked }))} />
              Rapor gerekli
            </label>
            <label>
              Rapor türü
              <select {...alan('raporTuru')}>
                <option value="">—</option>
                <option value="uzman">Uzman hekim</option>
                <option value="saglik-kurulu">Sağlık kurulu</option>
              </select>
            </label>
            <label>Raporu düzenleyen branşlar<input placeholder="virgülle ayırın" {...alan('raporBranslari')} /></label>
            <label>Reçete eden branşlar<input placeholder="boşsa tüm hekimler" {...alan('receteBranslari')} /></label>
            <label>İzinli ICD-10 tanıları<input placeholder="I25, I21" {...alan('tanilar')} /></label>
            <label>Azami günlük doz<input type="number" step="any" min="0" {...alan('maksDoz')} /></label>
            <label>Azami tedavi günü<input type="number" min="1" {...alan('maksGun')} /></label>
            <label>
              Reçete türü
              <select {...alan('receteTuru')}>
                <option value="">—</option>
                <option value="kirmizi">Kırmızı</option>
                <option value="yesil">Yeşil</option>
                <option value="mor">Mor</option>
                <option value="turuncu">Turuncu</option>
              </select>
            </label>
          </fieldset>
          <div className="eylemler">
            <button className="birincil" type="submit">
              Taslak olarak kaydet
            </button>
          </div>
        </form>
      )}

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

      <section className="kart">
        <table>
          <thead>
            <tr>
              <th>Durum</th>
              <th>Kural</th>
              <th>Koşullar</th>
              <th>Kaynak</th>
              <th>Geçerlilik</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {kurallar.map((k) => {
              const d = durum(k);
              return (
                <tr key={k.id}>
                  <td>
                    <span className={`etiket ${d}`}>{DURUM_ADI[d]}</span>
                  </td>
                  <td>
                    <strong>{k.etkenMadde}</strong>
                    <div className="soluk">{k.aciklama}</div>
                    <code>{k.id}</code>
                  </td>
                  <td>{kosullar(k)}</td>
                  <td>
                    {k.kaynak.tur} {k.kaynak.madde}
                    {k.kaynak.resmiGazete && <div className="soluk">RG {k.kaynak.resmiGazete.tarih}</div>}
                  </td>
                  <td>
                    {k.gecerlilik.baslangic} – {k.gecerlilik.bitis ?? '…'}
                    {k.onay && (
                      <div className="soluk">
                        Onay: {k.onay.onaylayan}, {k.onay.tarih}
                      </div>
                    )}
                  </td>
                  <td className="satir-eylem">
                    {d === 'taslak' && (
                      <>
                        <button onClick={() => onayla(k)}>Onayla</button>
                        <button onClick={() => sil(k)}>Sil</button>
                      </>
                    )}
                    {d === 'onayli' && <button onClick={() => kapat(k)}>Geçerliliği kapat</button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </>
  );
}
