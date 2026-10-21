-- SGK EK-4/A (Bedeli Ödenecek İlaçlar Listesi) sürümleri. Liste tüm eczanelerde ortaktır.
-- Her yükleme yeni bir sürümdür; eski sürümler silinmez, geçmiş kontrollerin hangi listeye göre yapıldığı izlenebilir.
create table ek4a_surum (
  id uuid primary key default gen_random_uuid(),
  yayim_tarihi date not null,
  dosya_adi text,
  yukleyen text not null,
  kullanici_id uuid not null references kullanici,
  zaman timestamptz not null default now(),
  kayit_sayisi integer not null check (kayit_sayisi > 0)
);

create table ek4a_kaydi (
  surum_id uuid not null references ek4a_surum,
  barkod text not null,
  ad text not null,
  kamu_no text,
  esdeger_grubu text,
  eski_barkodlar text[] not null default '{}',
  primary key (surum_id, barkod)
);

create trigger ek4a_surum_degismez before update or delete on ek4a_surum
  for each row execute function degistirilemez();
create trigger ek4a_kaydi_degismez before update or delete on ek4a_kaydi
  for each row execute function degistirilemez();
