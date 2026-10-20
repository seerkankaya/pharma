-- Ürün kartları: eczaneye özel ad, fiyat, KDV ve kritik stok.
create table urun (
  eczane_id uuid not null references eczane,
  barkod text not null,
  veri jsonb not null check (veri ->> 'barkod' = barkod),
  guncelleme timestamptz not null default now(),
  primary key (eczane_id, barkod)
);

-- Satışlar ve stok hareketleri yalnızca eklenir. Hata düzeltmesi ters hareketle yapılır.
create table satis (
  id uuid primary key,
  eczane_id uuid not null references eczane,
  kullanici_id uuid not null references kullanici,
  zaman timestamptz not null,
  veri jsonb not null
);
create index satis_eczane_zaman on satis (eczane_id, zaman);

create table stok_hareketi (
  sira bigserial primary key,
  eczane_id uuid not null references eczane,
  barkod text not null,
  tur text not null check (tur in ('giris', 'satis', 'imha')),
  miktar integer not null check (miktar <> 0),
  parti_no text not null,
  skt date not null,
  birim_maliyet_kurus integer,
  satis_id uuid references satis,
  aciklama text,
  kullanici_id uuid not null references kullanici,
  zaman timestamptz not null,
  check ((tur = 'giris') = (miktar > 0)),
  check ((tur = 'satis') = (satis_id is not null))
);
create index stok_hareketi_urun on stok_hareketi (eczane_id, barkod);

create function degistirilemez() returns trigger language plpgsql as $$
begin
  raise exception '% kayıtları değiştirilemez ve silinemez', tg_table_name;
end $$;
create trigger satis_degismez before update or delete on satis
  for each row execute function degistirilemez();
create trigger satis_bosaltilamaz before truncate on satis
  for each statement execute function degistirilemez();
create trigger stok_hareketi_degismez before update or delete on stok_hareketi
  for each row execute function degistirilemez();
create trigger stok_hareketi_bosaltilamaz before truncate on stok_hareketi
  for each statement execute function degistirilemez();
