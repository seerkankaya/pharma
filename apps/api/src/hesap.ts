import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

// Her eczane kendi hesabıdır; kullanıcılar bir eczaneye bağlıdır ve yalnızca o eczanenin kayıtlarını görür.
// eczaci: eczane sahibi veya mesul müdür, kullanıcı ekler/kapatır. calisan: reçete kontrol eder ve gönderir.
// kuralYetkisi eczane rolünden bağımsızdır: ortak SUT kural kitaplığını düzenleyip onaylayabilen eczacılar.

export type Rol = 'eczaci' | 'calisan';

export interface Eczane {
  id: string;
  ad: string;
}

export interface Kullanici {
  id: string;
  eczaneId: string;
  eposta: string;
  adSoyad: string;
  rol: Rol;
  kuralYetkisi: boolean;
  aktif: boolean;
  parolaOzeti: string;
}

export type YeniKullanici = Omit<Kullanici, 'id' | 'aktif'>;

/** Oturumdaki kullanıcı; isteklerde req.kullanici olarak bulunur. */
export interface OturumKullanicisi {
  id: string;
  eczaneId: string;
  eczaneAd: string;
  eposta: string;
  adSoyad: string;
  rol: Rol;
  kuralYetkisi: boolean;
}

export class EpostaKullanimdaHatasi extends Error {
  constructor(eposta: string) {
    super(`${eposta} adresiyle kayıtlı bir kullanıcı zaten var`);
  }
}

export interface HesapDeposu {
  eczaneEkle(ad: string): Promise<Eczane>;
  /** Aynı e-posta varsa EpostaKullanimdaHatasi fırlatır. */
  kullaniciEkle(k: YeniKullanici): Promise<Kullanici>;
  epostaylaBul(eposta: string): Promise<Kullanici | undefined>;
  eczaneKullanicilari(eczaneId: string): Promise<Kullanici[]>;
  /** Kullanıcıyı açar ya da kapatır; kapatılan kullanıcının oturumları silinir. Kullanıcı o eczanede yoksa false döner. */
  kullaniciDurumu(id: string, eczaneId: string, aktif: boolean): Promise<boolean>;
  oturumEkle(tokenOzeti: string, kullaniciId: string, bitis: Date): Promise<void>;
  /** Süresi dolmamış ve kullanıcısı aktif oturumu verir. */
  oturumBul(tokenOzeti: string, simdi: Date): Promise<OturumKullanicisi | undefined>;
  oturumSil(tokenOzeti: string): Promise<void>;
}

export const epostaDuzelt = (eposta: string) => eposta.trim().toLocaleLowerCase('en-US');

const scryptAsync = promisify(scrypt) as (parola: string, tuz: Buffer, uzunluk: number) => Promise<Buffer>;

export async function parolaOzetle(parola: string): Promise<string> {
  const tuz = randomBytes(16);
  const ozet = await scryptAsync(parola, tuz, 64);
  return `scrypt$${tuz.toString('base64')}$${ozet.toString('base64')}`;
}

export async function parolaDogru(parola: string, kayitli: string): Promise<boolean> {
  const [yontem, tuz, ozet] = kayitli.split('$');
  if (yontem !== 'scrypt' || !tuz || !ozet) return false;
  const beklenen = Buffer.from(ozet, 'base64');
  const hesaplanan = await scryptAsync(parola, Buffer.from(tuz, 'base64'), beklenen.length);
  return timingSafeEqual(beklenen, hesaplanan);
}

export const ASGARI_PAROLA_UZUNLUGU = 10;

/** Oturum belirteci; tarayıcıya belirtecin kendisi, veritabanına yalnızca özeti gider. */
export function oturumBelirteci() {
  const belirtec = randomBytes(32).toString('base64url');
  return { belirtec, ozet: belirtecOzeti(belirtec) };
}

export const belirtecOzeti = (belirtec: string) => createHash('sha256').update(belirtec).digest('hex');

export const disaAcik = ({ parolaOzeti: _p, ...k }: Kullanici) => k;

export class BellekHesapDeposu implements HesapDeposu {
  private eczaneler = new Map<string, Eczane>();
  private kullanicilar = new Map<string, Kullanici>();
  private oturumlar = new Map<string, { kullaniciId: string; bitis: Date }>();

  async eczaneEkle(ad: string) {
    const e = { id: randomUUID(), ad };
    this.eczaneler.set(e.id, e);
    return { ...e };
  }

  async kullaniciEkle(k: YeniKullanici) {
    const eposta = epostaDuzelt(k.eposta);
    if (await this.epostaylaBul(eposta)) throw new EpostaKullanimdaHatasi(eposta);
    const yeni = { ...k, eposta, id: randomUUID(), aktif: true };
    this.kullanicilar.set(yeni.id, yeni);
    return { ...yeni };
  }

  async epostaylaBul(eposta: string) {
    const e = epostaDuzelt(eposta);
    const k = [...this.kullanicilar.values()].find((x) => x.eposta === e);
    return k && { ...k };
  }

  async eczaneKullanicilari(eczaneId: string) {
    return [...this.kullanicilar.values()].filter((k) => k.eczaneId === eczaneId).map((k) => ({ ...k }));
  }

  async kullaniciDurumu(id: string, eczaneId: string, aktif: boolean) {
    const k = this.kullanicilar.get(id);
    if (!k || k.eczaneId !== eczaneId) return false;
    k.aktif = aktif;
    if (!aktif) for (const [t, o] of this.oturumlar) if (o.kullaniciId === id) this.oturumlar.delete(t);
    return true;
  }

  async oturumEkle(tokenOzeti: string, kullaniciId: string, bitis: Date) {
    this.oturumlar.set(tokenOzeti, { kullaniciId, bitis });
  }

  async oturumBul(tokenOzeti: string, simdi: Date): Promise<OturumKullanicisi | undefined> {
    const o = this.oturumlar.get(tokenOzeti);
    if (!o || o.bitis <= simdi) return undefined;
    const k = this.kullanicilar.get(o.kullaniciId);
    if (!k?.aktif) return undefined;
    const { parolaOzeti: _p, aktif: _a, ...kalan } = k;
    return { ...kalan, eczaneAd: this.eczaneler.get(k.eczaneId)?.ad ?? '' };
  }

  async oturumSil(tokenOzeti: string) {
    this.oturumlar.delete(tokenOzeti);
  }
}
