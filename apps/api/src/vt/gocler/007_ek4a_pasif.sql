-- 2026 biçimli EK-4/A dosyası ilaçların aktiflenme ve pasiflenme tarihlerini taşıyor.
-- Pasif dönemde yazılan reçetenin bedeli ödenmez; dönemler [{"baslangic","bitis"?}] olarak saklanır.
alter table ek4a_kaydi add column pasif_araliklari jsonb;
