import type { Recete } from '@scalpiq/sut-motoru';

export interface MedulaGonderimSonucu {
  basarili: boolean;
  takipNo?: string;
  hata?: string;
}

/**
 * Medula Eczane web servislerine erişim.
 * Gerçek istemci, eczanenin SGK'ya tanımlı sabit IP'sinden çıkan geçit üzerinden çağrı yapacak.
 */
export interface MedulaIstemcisi {
  receteGonder(recete: Recete): Promise<MedulaGonderimSonucu>;
}

/** Geliştirme ve test için Medula'ya gitmeyen istemci. */
export class SahteMedula implements MedulaIstemcisi {
  readonly gonderilenler: Recete[] = [];

  async receteGonder(recete: Recete): Promise<MedulaGonderimSonucu> {
    this.gonderilenler.push(recete);
    return { basarili: true, takipNo: `SAHTE-${recete.no}-${this.gonderilenler.length}` };
  }
}
