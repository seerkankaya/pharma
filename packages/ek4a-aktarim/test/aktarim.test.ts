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
