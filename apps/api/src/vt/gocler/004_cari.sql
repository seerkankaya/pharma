-- Veresiye müşterileri ve cari hareketler.
create table musteri (
  id uuid primary key default gen_random_uuid(),
  eczane_id uuid not null references eczane,
  ad_soyad text not null,
  telefon text,
  limit_kurus integer check (limit_kurus >= 0),
  "not" text,
  olusturma timestamptz not null default now()
);
create index musteri_eczane on musteri (eczane_id);

-- Borç ve tahsilatlar yalnızca eklenir; bakiye bunlardan hesaplanır.
create table cari_hareket (
  sira bigserial primary key,
  eczane_id uuid not null references eczane,
  musteri_id uuid not null references musteri,
  tur text not null check (tur in ('borc', 'tahsilat')),
  tutar_kurus integer not null check (tutar_kurus > 0),
  satis_id uuid references satis,
  odeme_turu text check (odeme_turu in ('nakit', 'kart')),
  aciklama text,
  kullanici_id uuid not null references kullanici,
  kaydeden text not null,
  zaman timestamptz not null,
  check ((tur = 'tahsilat') = (odeme_turu is not null))
);
create index cari_hareket_musteri on cari_hareket (eczane_id, musteri_id);

create trigger cari_hareket_degismez before update or delete on cari_hareket
  for each row execute function degistirilemez();
create trigger cari_hareket_bosaltilamaz before truncate on cari_hareket
  for each statement execute function degistirilemez();
