# ScalpIQ-Pharma

Bulut tabanlı eczane yazılımı. İlk modül: **reçete Medula'ya gönderilmeden önce SUT kontrolü**.

Reçete açıldığı anda kendiliğinden kontrol edilir ve sonuç üç durumdan biri olur:

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
| `apps/api` | Fastify API: oturum, kontrol, gönderim, denetim, kural kitaplığı, kullanıcılar. PostgreSQL'de saklar. Medula şimdilik sahte istemciyle |
| `apps/api/src/vt/gocler` | Veritabanı şeması. Sunucu açılırken uygulanmamış dosyaları sırayla uygular |
| `apps/api/src/stok` | Stok ve satış: ürün kartı, parti ve son kullanma tarihi, FEFO ile satış, imha |
| `apps/api/src/alis` | Alış faturası, tedarikçiler, sipariş önerisi |
| `apps/web` | React ekranları: giriş, reçete kontrol, satış, stok, kural kitaplığı, denetim kaydı, kullanıcılar |

## Çalıştırma

Node.js 22 ve PostgreSQL 16 gerekir. PostgreSQL için en kolayı Docker:

```bash
npm install
docker compose up -d   # yerel PostgreSQL (scalpiq ve scalpiq_test veritabanları)
                       # 5432 doluysa: PG_PORT=5434 docker compose up -d ve DATABASE_URL ile 5434'ü verin
npm run kurulum -- --eczane "Kaya Eczanesi" --eposta serkan@ornek.com --ad "Ecz. Serkan Kaya" --kural-yetkisi
npm run api            # API: http://127.0.0.1:3001
npm run web            # Ekran: http://localhost:5173 (ayrı terminalde)
```

`kurulum` eczane hesabını ve ilk eczacıyı açar, parolayı bir kez ekrana yazar. Başka bir veritabanı için `DATABASE_URL` verin.

```bash
npm test            # testler (veritabanı gerekmez)
npm run test:vt     # PostgreSQL testleri (scalpiq_test veritabanının içini siler)
npm run typecheck   # tip kontrolü
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

## Hesaplar ve yetkiler

Her eczane ayrı bir hesaptır. Kullanıcılar yalnızca kendi eczanelerinin kontrollerini ve denetim kaydını görür.

| Yetki | Ne yapabilir |
| --- | --- |
| Çalışan | Reçete kontrol eder, gönderir, denetim kaydını ve kural kitaplığını görür |
| Eczacı | Çalışanın yaptıkları, ayrıca eczanesine kullanıcı ekler ve kapatır |
| Kural yetkisi | Eczane rolünden ayrı. Ortak kural kitaplığına kural ekler, onaylar, kapatır. Yalnızca `kurulum` ile verilir |

- Parolalar scrypt ile özetlenir. Oturum çerezi HttpOnly ve SameSite=Strict'tir, canlıda (`NODE_ENV=production`) yalnızca HTTPS ile gönderilir. Veritabanında oturum belirtecinin yalnızca özeti tutulur.
- Aynı e-postayla 5 hatalı girişten sonra hesap 15 dakika kilitlenir.
- Kapatılan kullanıcının açık oturumları hemen düşer.
- Gönderen kişinin adı denetim kaydına yazılır.

## Veritabanı güvenceleri

Uygulamadaki kuralların bir kopyası veritabanında da tetikleyici olarak durur. Böylece koddaki bir hata bunları delemez:

- Denetim kaydı değiştirilemez, silinemez ve boşaltılamaz.
- Onaylı kural silinemez. Değiştirilebilecek tek alanı, bir kez olmak üzere geçerlilik bitişidir.
- Bir kontrol yalnızca bir kez gönderilir. Aynı anda gelen iki gönderim isteğinden yalnızca biri Medula'ya gider.
- Gönderimin tamamlanması ve denetim kaydı aynı veritabanı işleminde yazılır.

## Stok ve satış

- **Ürün kartı:** Eczacı açar; ad, KDV oranı, KDV dahil satış fiyatı ve kritik stok içerir. Barkod EK-4/A'da varsa ürün ilaç sayılır ve adı listeden önerilir.
- **Stok girişi:** Parti numarası ve son kullanma tarihiyle yapılır. Miadı geçmiş ürün stoğa alınamaz.
- **Satış:** Barkod okutulur. Fiyat istemciden değil ürün kartından alınır. Stok, miadı en yakın partiden başlayarak düşülür (FEFO).
  - Miadı geçmiş parti hiçbir koşulda satılmaz.
  - Yetersiz stokta satış hiç yazılmaz.
  - Aynı anda iki kasa son kutuları birlikte satamaz.
- **Uyarılar:** Miadı geçmiş parti, miadına 90 gün ya da daha az kalan parti ve kritik stok.
- **İmha:** Miadı geçen ya da bozulan ürünü eczacı gerekçeyle stoktan düşer.
- **Hareket kayıtları:** Stok hareketleri ve satışlar veritabanında değiştirilemez ve silinemez.
- **Gün sınırı:** Günlük satış özeti ve "bugün" Türkiye saatine göre hesaplanır.

## Alış ve sipariş

- **Tedarikçiler:** Ecza depolarını eczacı ekler.
- **Alış faturası:**
  - Her satır parti numarası ve son kullanma tarihiyle stoğa girer.
  - Birim fiyatlar KDV hariçtir. İskonto KDV'den önce uygulanır.
  - Mal fazlası (MF) stoğa girer ve birim maliyete dağıtılır.
  - Kartı olmayan ürünün kartı faturayla birlikte açılır; bunun için ad ve satış fiyatı gerekir.
- **Tek işlem:** Fatura, yeni kartlar ve stok girişleri birlikte yazılır. Biri yazılamazsa hiçbiri yazılmaz.
- **Tekrar engeli:** Aynı tedarikçiden aynı numaralı fatura iki kez girilemez.
- **Değiştirilemez kayıt:** Fatura kaydı veritabanında değiştirilemez.
- **Sipariş önerisi:** Kritik stoğa inen ürünler listelenir. Öneri, stoğu kritik stoğun iki katına tamamlar. Son tedarikçi ve son maliyet de gösterilir.

Reçeteli satış (hasta katılım payı, reçete ilaçlarının stoktan düşülmesi) Medula bağlantısıyla birlikte gelecek.

## Kural kitaplığı

Kurallar tüm eczanelerde ortaktır ve veritabanında tutulur. Kitaplık boşsa örnek kurallarla başlar. Akış:

1. Kural **taslak** olarak eklenir. Taslak kontrolde kullanılmaz.
2. Kural yetkisi olan eczacı kuralı SUT metniyle karşılaştırır ve **onaylar**. Onaylayanın adı oturumdan alınır. Aynı etken madde için aynı tarihlerde geçerli başka onaylı kural varsa onay reddedilir.
3. SUT değişince eski kuralın **geçerliliği kapatılır**, yeni sürüm taslak olarak eklenip onaylanır.

Onaylı kural düzenlenemez ve silinemez; her uyarı ve denetim kaydı dayandığı kuralın kimliğini (`ilacKuraliId`) taşır.

## Sıradaki işler

- Gerçek kural kitaplığı: en çok kesinti yenen ilaç gruplarından başlayarak SUT'tan kodlama
- Medula Eczane web servis istemcisi ve sabit IP geçidi
- Reçete okuma (e-reçete sorgu) ve gerçek reçete girişi
- Parola değiştirme ve sıfırlama, iki adımlı doğrulama
- Ürün planındaki diğer modüller: satış, stok, İTS, e-Fatura, yazar kasa…
