import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { ek4aListesiOlustur, ek4aOku } from '../src/index.js';

// SGK'nın yayımladığı dosyanın başlık düzeni (2017 tarihli EK-4/A dosyasından alınmıştır).
function ornekDosya(): Uint8Array {
  const satirlar = [
    ['EK- 4/A '],
    ['BEDELİ ÖDENECEK İLAÇLAR LİSTESİ'],
    ['Kamu No', 'Güncel Barkod', 'Ürün Adı', 'Eski Barkod-1', 'Eski Barkod-2', 'Eşdeğer (Benzer) Ürün Grubu', 'Referans Fiyat Grubu', 'Listeye Giriş Tarihi', 'Orijinal / Jenerik / Yirmi Yıllık'],
    ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'],
    ['A15362', 8699525698674, '%0,9 IZOTONIK SODYUM KLORUR COZ 1000 ML', null, null, 'E219K', null, 42397, 'YİRMİ YIL'],
    ['A00145', 8699828690757, '%5 DEKSTROZ 150 ML SOL (SETLI TORBA)', 8699556690111, null, 'E318F', null, null, 'YİRMİ YIL'],
    ['A99999', 'hatalı', 'BOZUK SATIR'],
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(satirlar), 'EK-4-A');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['diğer']]), 'EK-4-B');
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
}

describe('EK-4/A aktarımı', () => {
  it('başlıkları adına göre bulur ve kayıtları okur', () => {
    const s = ek4aOku(ornekDosya());
    expect(s.sayfa).toBe('EK-4-A');
    expect(s.kayitlar).toHaveLength(2);
    expect(s.kayitlar[0]).toMatchObject({
      kamuNo: 'A15362',
      barkod: '8699525698674',
      esdegerGrubu: 'E219K',
      listeyeGirisTarihi: '2016-01-28',
      tur: 'YİRMİ YIL',
    });
    expect(s.kayitlar[1]!.eskiBarkodlar).toEqual(['8699556690111']);
    expect(s.uyarilar).toEqual(['7. satır: geçerli barkod yok (BOZUK SATIR)']);
  });

  it('eski barkodla da arama yapılabilir', () => {
    const liste = ek4aListesiOlustur('2026-10-15', ek4aOku(ornekDosya()));
    expect(liste.bul('8699556690111')?.ad).toContain('DEKSTROZ');
    expect(liste.bul('8690000000000')).toBeUndefined();
  });
});

// 2026 dosyasının başlık düzeni: tek "Eski Barkodlar" sütunu, aktiflenme ve pasiflenme tarihleri.
function yeniDosya(): Uint8Array {
  const satirlar = [
    ['BEDELİ ÖDENECEK İLAÇLAR LİSTESİ (EK-4/A)'],
    ['Kamu No', 'Güncel Barkod', 'İlaç Adı', 'Eski Barkodlar', 'Eşdeğer İlaç Grubu', 'Terapötik Referans Grubu', 'Listeye Giriş Tarihi', 'Aktiflenme Tarihi', 'Pasiflenme Tarihi', 'Uygulanan İndirim Oranlarına Esas Durumu'],
    ['A04061', 8699788681017, '%0,9 IZOTONIK SODYUM KLORUR', null, 'E219K', null, 38964, null, null, 'FIYAT KORUMALI'],
    ['A20001', 8699569092810, 'IKI ESKI BARKODLU ILAC', '8699569092797\r\n8699569092728', null, null, null, null, null, 'EŞDEĞER'],
    ['A16935', 8699832090604, 'ADENURIC 120 MG 28 FILM KAPLI TABLET', null, 'E787A', null, 43473, '02.03.2024/\r\n07.07.2026', '2.01.2024/ 02.03.2026', 'REFERANS'],
    ['A18000', 8681911590099, 'HALA PASIF ILAC', null, null, null, null, null, 44711, 'EŞDEĞER'],
    [null, null, 'ZZZ MAJISTRAL ILAC', null, null, null, null, null, null, 'MAJİSTRAL'],
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(satirlar), 'EK-4A');
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
}

describe('2026 biçimli EK-4/A', () => {
  it('yeni başlıkları, çoklu eski barkodları ve pasif dönemleri okur', () => {
    const s = ek4aOku(yeniDosya());
    expect(s.sayfa).toBe('EK-4A');
    expect(s.uyarilar).toEqual([]);
    expect(s.kayitlar).toHaveLength(4);
    expect(s.kayitlar[0]).toMatchObject({ esdegerGrubu: 'E219K', tur: 'FIYAT KORUMALI', listeyeGirisTarihi: '2006-09-04' });
    expect(s.kayitlar[0]!.pasifAraliklari).toBeUndefined();
    expect(s.kayitlar[1]!.eskiBarkodlar).toEqual(['8699569092797', '8699569092728']);
    expect(s.kayitlar[2]!.pasifAraliklari).toEqual([
      { baslangic: '2024-01-02', bitis: '2024-03-01' },
      { baslangic: '2026-03-02', bitis: '2026-07-06' },
    ]);
    expect(s.kayitlar[3]!.pasifAraliklari).toEqual([{ baslangic: '2022-05-30' }]);
  });

  it('eski barkodların her biri aynı ilaca yönlenir', () => {
    const liste = ek4aListesiOlustur('2026-10-02', ek4aOku(yeniDosya()));
    expect(liste.bul('8699569092728')?.ad).toBe('IKI ESKI BARKODLU ILAC');
  });
});
