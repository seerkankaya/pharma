// İlaç kutusundaki karekodun (GS1 DataMatrix) ayrıştırılması.
// Türkiye'deki ilaç karekodunda dört alan bulunur: (01) GTIN, (21) seri no, (17) son kullanma tarihi, (10) parti no.
// Uzunluğu değişen alanlar (21 ve 10) GS karakteriyle (ASCII 29) biter; okuyucu bunu kimi zaman "<GS>" diye yazar.

export interface Karekod {
  /** 14 haneli GTIN */
  gtin: string;
  /** Ürün kartındaki barkod: GTIN'in baştaki sıfırı atılmış hali (869... ile başlayan 13 hane) */
  barkod: string;
  seriNo: string;
  /** YYYY-AA-GG */
  skt: string;
  partiNo: string;
  /** Okunan karekod ayırıcı içermiyordu ve alanlar tahminle ayrıldı */
  tahmini?: boolean;
}

export class KarekodHatasi extends Error {}

const GS = '\x1d';
const SABIT: Record<string, number> = { '01': 14, '11': 6, '17': 6 };
const DEGISKEN = new Set(['10', '21']);

/** GTIN'in son hanesi (kontrol hanesi) doğru mu? */
export function gtinGecerli(gtin: string) {
  if (!/^\d{14}$/.test(gtin)) return false;
  const toplam = [...gtin.slice(0, 13)].reduce((t, h, i) => t + Number(h) * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (toplam % 10)) % 10 === Number(gtin[13]);
}

/** GS1 tarihini (YYAAGG) YYYY-AA-GG yapar. Gün 00 ise ayın son günü kabul edilir. */
export function gs1Tarih(yyaagg: string) {
  if (!/^\d{6}$/.test(yyaagg)) throw new KarekodHatasi('Son kullanma tarihi 6 haneli olmalı');
  const yil = 2000 + Number(yyaagg.slice(0, 2));
  const ay = Number(yyaagg.slice(2, 4));
  let gun = Number(yyaagg.slice(4, 6));
  if (ay < 1 || ay > 12) throw new KarekodHatasi(`Son kullanma tarihinde ay geçersiz: ${yyaagg}`);
  const ayinSonu = new Date(Date.UTC(yil, ay, 0)).getUTCDate();
  if (gun === 0) gun = ayinSonu;
  if (gun > ayinSonu) throw new KarekodHatasi(`Son kullanma tarihinde gün geçersiz: ${yyaagg}`);
  return `${yil}-${String(ay).padStart(2, '0')}-${String(gun).padStart(2, '0')}`;
}

function alanlariOku(metin: string): Map<string, string> {
  const alanlar = new Map<string, string>();
  let i = 0;
  while (i < metin.length) {
    if (metin[i] === GS) {
      i++;
      continue;
    }
    const ai = metin.slice(i, i + 2);
    i += 2;
    let deger: string;
    if (SABIT[ai]) {
      deger = metin.slice(i, i + SABIT[ai]);
      if (deger.length !== SABIT[ai]) throw new KarekodHatasi(`(${ai}) alanı eksik`);
      i += SABIT[ai];
    } else if (DEGISKEN.has(ai)) {
      const son = metin.indexOf(GS, i);
      deger = metin.slice(i, son === -1 ? undefined : son);
      i = son === -1 ? metin.length : son + 1;
      if (!deger || deger.length > 20) throw new KarekodHatasi(`(${ai}) alanı 1-20 karakter olmalı`);
    } else throw new KarekodHatasi(`Tanınmayan karekod alanı: (${ai})`);
    if (alanlar.has(ai)) throw new KarekodHatasi(`(${ai}) alanı iki kez geçiyor`);
    alanlar.set(ai, deger);
  }
  return alanlar;
}

/**
 * Ayırıcısız okunmuş karekod: 01 GTIN 21 SERİ 17 TARİH 10 PARTİ sırası varsayılır ve
 * seri numarasının arkasındaki geçerli "17AAAAGG10" dizisinden bölünür. Birden fazla olasılık varsa hata verir.
 */
function ayiricisizOku(metin: string): Map<string, string> | undefined {
  const m = /^01(\d{14})21(.+)$/.exec(metin);
  if (!m) return undefined;
  const kalan = m[2]!;
  const adaylar: Map<string, string>[] = [];
  for (let i = 1; i + 10 <= kalan.length; i++) {
    if (kalan.slice(i, i + 2) !== '17' || kalan.slice(i + 8, i + 10) !== '10') continue;
    const seri = kalan.slice(0, i);
    const tarih = kalan.slice(i + 2, i + 8);
    const parti = kalan.slice(i + 10);
    if (seri.length > 20 || !parti || parti.length > 20) continue;
    try {
      gs1Tarih(tarih);
    } catch {
      continue;
    }
    adaylar.push(
      new Map([
        ['01', m[1]!],
        ['21', seri],
        ['17', tarih],
        ['10', parti],
      ]),
    );
  }
  return adaylar.length === 1 ? adaylar[0] : undefined;
}

/** Karekod okuyucudan gelen metni alanlarına ayırır. Hatalı karekodda KarekodHatasi fırlatır. */
export function karekodAyristir(okunan: string): Karekod {
  const metin = okunan.trim().replace(/^\]d2/, '').replace(/<GS>/gi, GS);
  let tahmini = false;
  let alanlar: Map<string, string>;
  if (metin.startsWith('(')) {
    // İnsanın okuyacağı biçim: (01)...(21)...(17)...(10)...
    alanlar = new Map();
    for (const p of metin.matchAll(/\((\d{2})\)([^(]*)/g)) alanlar.set(p[1]!, p[2]!.trim());
  } else if (metin.includes(GS)) alanlar = alanlariOku(metin);
  else {
    // Ayırıcı yoksa seri no sondaki tüm alanları yutar; bu durumda sırayı tahmin ederek böl.
    let okunan: Map<string, string> | undefined;
    let hata: unknown;
    try {
      okunan = alanlariOku(metin);
    } catch (e) {
      hata = e;
    }
    if (okunan?.has('17') && okunan.has('10')) alanlar = okunan;
    else {
      const t = ayiricisizOku(metin);
      if (!t) {
        if (hata && !metin.startsWith('01')) throw hata;
        throw new KarekodHatasi('Karekod alanları ayrılamadı; okuyucunun GS ayırıcısını gönderdiğinden emin olun');
      }
      alanlar = t;
      tahmini = true;
    }
  }
  const gtin = alanlar.get('01');
  const seriNo = alanlar.get('21');
  const skt = alanlar.get('17');
  const partiNo = alanlar.get('10');
  if (!gtin || !seriNo || !skt || !partiNo) throw new KarekodHatasi('Karekodda GTIN, seri no, son kullanma tarihi ve parti no bulunmalı');
  if (!gtinGecerli(gtin)) throw new KarekodHatasi(`GTIN geçersiz: ${gtin}`);
  return {
    gtin,
    barkod: gtin.startsWith('0') ? gtin.slice(1) : gtin,
    seriNo,
    skt: gs1Tarih(skt),
    partiNo,
    ...(tahmini ? { tahmini } : {}),
  };
}

/** Tekil ürünün kimliği: GTIN ile seri numarası birlikte her kutuyu tek başına tanımlar. */
export const tekilId = (k: Pick<Karekod, 'gtin' | 'seriNo'>) => `${k.gtin}:${k.seriNo}`;
