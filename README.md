# ScalpIQ-Pharma

Bulut tabanlı eczane yazılımı. İlk modül: **reçete Medula'ya gönderilmeden önce SUT kontrolü**.

Reçete kontrol edilir ve sonuç üç durumdan biri olur:

- **Kırmızı (uygun değil):** Medula'ya gönderim kilitlenir. Düzeltilmeden geçilemez.
- **Sarı (dikkat):** Eczacı her uyarı için gerekçe yazınca gönderim açılır. Gerekçe denetim kaydına yazılır.
- **Yeşil (uygun):** Reçete gönderilir.

Her uyarı dayandığı kaynağı gösterir: SUT maddesi, EK-4/A listesi, Resmî Gazete tarihi.

> **Önemli:** `packages/sut-motoru/src/kurallar/ornek-kurallar.ts` içindeki ilaç kuralları **örnektir, gerçek SUT hükmü değildir.**
> Canlı kullanımdan önce kural kitaplığı güncel SUT metninden uzman eczacı onayıyla kodlanmalıdır.
> `varsayilanAyarlar.receteGecerlilikGunu` değeri de SUT'tan doğrulanmalıdır.

## Yapı

| Klasör | İçerik |
| --- | --- |
| `packages/sut-motoru` | Kural motoru: veri modeli, kontrol kuralları, gönderim kilidi, örnek kurallar ve örnek reçeteler |
| `packages/ek4a-aktarim` | SGK EK-4/A Excel dosyasını (xls/xlsx) okuyup barkodla aranabilir listeye çevirir |
| `apps/api` | Fastify API: `/api/kontrol`, `/api/gonder`, `/api/denetim`. Medula şimdilik sahte istemciyle |
| `apps/web` | React kontrol ekranı |

## Çalıştırma

Node.js 22 gerekir.

```bash
npm install
npm test            # tüm testler
npm run typecheck   # tip kontrolü
npm run api         # API: http://127.0.0.1:3001
npm run web         # Ekran: http://localhost:5173 (ayrı terminalde)
```

Örnek reçeteler 20.10.2026 tarihlidir. Başka bir günde denerken API'yi `SCALPIQ_BUGUN=2026-10-20 npm run api` ile başlatın.

## Kontrol kuralları

| Kural | Seviye | Ne kontrol eder |
| --- | --- | --- |
| `EK4A_LISTE` | Kırmızı | Barkod güncel EK-4/A listesinde mi (eski barkodlar dahil) |
| `KURAL_TANIMSIZ` | Sarı | İlaç için kural kitaplığında kayıt var mı |
| `RECETE_TURU` | Kırmızı | Kırmızı, yeşil vb. reçete türü gereği |
| `RECETE_EDEN_BRANS` | Kırmızı | Reçeteyi yazan hekimin branşı |
| `RAPOR_GEREKLI` | Kırmızı | Rapor gerekiyorsa reçetede rapor var mı |
| `RAPOR_TURU` | Kırmızı | Uzman hekim veya sağlık kurulu raporu |
| `RAPOR_SURESI` | Kırmızı | Rapor reçete tarihinde geçerli mi |
| `RAPOR_BRANS` | Kırmızı | Raporu düzenleyen branş |
| `TANI_UYUMU` | Kırmızı | Rapordaki ICD-10 tanısı ödeme koşuluna uyuyor mu |
| `DOZ` | Kırmızı | Reçete dozu rapordaki ve izin verilen dozu aşıyor mu |
| `TEDAVI_SURESI` | Sarı | Verilen miktar izin verilen tedavi süresini aşıyor mu |
| `ERKEN_TEKRAR` | Sarı | Önceki ilaç bitmeden yeniden veriliyor mu |
| `RECETE_GECERLILIK` | Kırmızı | Reçete karşılama süresi |
| `UYARI_KODU` | Kırmızı | Girilen uyarı kodu reçetede gerçekten var mı |

İlaca özgü koşullar `IlacKurali` kayıtlarında tutulur. Her kaydın kaynağı ve geçerlilik aralığı vardır. SUT değiştiğinde eski kayıt kapatılır, yenisi eklenir; böylece geçmiş tarihli reçeteler doğru kuralla kontrol edilir.

Not: SGK'nın EK-4/A listesi bir ödeme ve fiyat listesidir; ilaçların rapor ve kullanım koşullarını içermez. Bu koşullar SUT metninden kural kitaplığına ayrıca kodlanır.

## Sıradaki işler

- Gerçek kural kitaplığı: en çok kesinti yenen ilaç gruplarından başlayarak SUT'tan kodlama
- Kural kitaplığı için yönetim ekranı (uzman eczacı onayı, sürüm geçmişi)
- Medula Eczane web servis istemcisi ve sabit IP geçidi
- Reçete okuma (e-reçete sorgu) ve gerçek reçete girişi
- Veritabanı (PostgreSQL), eczane hesapları ve yetkiler
- Ürün planındaki diğer modüller: satış, stok, İTS, e-Fatura, yazar kasa…
