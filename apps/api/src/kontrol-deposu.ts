import type { Bulgu, Durum, Gerekceler, KontrolSonucu, Recete } from '@scalpiq/sut-motoru';

/**
 * Kontrol edilen reçete ve sonucu. Gönderim yalnızca kontrol kimliğiyle yapılır;
 * böylece istemci kontrol edilmemiş ya da kontrolden sonra değiştirilmiş bir reçeteyi gönderemez.
 */
export interface KayitliKontrol {
  id: string;
  eczaneId: string;
  kullaniciId: string;
  recete: Recete;
  sonuc: KontrolSonucu;
  durum: 'bekliyor' | 'gonderiliyor' | 'gonderildi';
  takipNo?: string;
}

/**
 * Medula'ya gönderilen her reçetenin kontrol izi.
 * SGK itirazında eczacının elindeki kanıt budur: hangi uyarı görüldü, kim hangi gerekçeyle geçti.
 */
export interface DenetimKaydi {
  zaman: string;
  kontrolId: string;
  receteNo: string;
  gonderen: string;
  durum: Durum;
  bulgular: Pick<Bulgu, 'kuralId' | 'seviye' | 'mesaj' | 'kaynaklar' | 'barkod' | 'ilacKuraliId'>[];
  gerekceler: Gerekceler;
  ek4aYayimTarihi: string;
  takipNo?: string;
}

export interface KontrolDeposu {
  ekle(k: Omit<KayitliKontrol, 'durum' | 'takipNo'>): Promise<void>;
  /** Kontrol başka eczaneye aitse bulunamamış sayılır. */
  al(id: string, eczaneId: string): Promise<KayitliKontrol | undefined>;
  /** bekliyor → gonderiliyor. Aynı reçetenin iki kez gönderilmesini önler; başka istek önce davrandıysa false döner. */
  gonderimiBaslat(id: string): Promise<boolean>;
  /** Medula hata verdiyse gonderiliyor → bekliyor. */
  gonderimiBirak(id: string): Promise<void>;
  /** gonderiliyor → gonderildi ve denetim kaydı aynı işlemde yazılır. */
  gonderimiTamamla(id: string, kayit: DenetimKaydi): Promise<void>;
  /** Eczanenin denetim kayıtları, en yenisi önce. Kayıtlar yalnızca eklenir, değiştirilmez. */
  denetimKayitlari(eczaneId: string): Promise<DenetimKaydi[]>;
}

export class BellekKontrolDeposu implements KontrolDeposu {
  private kontroller = new Map<string, KayitliKontrol>();
  private denetim: (DenetimKaydi & { eczaneId: string })[] = [];

  async ekle(k: Omit<KayitliKontrol, 'durum' | 'takipNo'>) {
    this.kontroller.set(k.id, structuredClone({ ...k, durum: 'bekliyor' }));
  }

  async al(id: string, eczaneId: string) {
    const k = this.kontroller.get(id);
    return k?.eczaneId === eczaneId ? structuredClone(k) : undefined;
  }

  async gonderimiBaslat(id: string) {
    const k = this.kontroller.get(id);
    if (k?.durum !== 'bekliyor') return false;
    k.durum = 'gonderiliyor';
    return true;
  }

  async gonderimiBirak(id: string) {
    const k = this.kontroller.get(id);
    if (k?.durum === 'gonderiliyor') k.durum = 'bekliyor';
  }

  async gonderimiTamamla(id: string, kayit: DenetimKaydi) {
    const k = this.kontroller.get(id);
    if (k?.durum !== 'gonderiliyor') throw new Error(`Kontrol ${id} gönderim aşamasında değil`);
    k.durum = 'gonderildi';
    k.takipNo = kayit.takipNo;
    this.denetim.push(structuredClone({ ...kayit, eczaneId: k.eczaneId }));
  }

  async denetimKayitlari(eczaneId: string) {
    return this.denetim
      .filter((d) => d.eczaneId === eczaneId)
      .map(({ eczaneId: _e, ...d }) => structuredClone(d))
      .reverse();
  }
}
