-- Emanet ilaçlar. Emanetle verilen ürün stoktan "emanet" hareketiyle düşer; gelen ürün "giris" hareketiyle girer.
alter table stok_hareketi drop constraint stok_hareketi_tur_check;
alter table stok_hareketi add constraint stok_hareketi_tur_check check (tur in ('giris', 'satis', 'imha', 'iade', 'emanet'));

create table emanet (
  eczane_id uuid not null references eczane,
  id text not null,
  veri jsonb not null,
  guncelleme timestamptz not null default now(),
  primary key (eczane_id, id)
);
create index emanet_durum on emanet (eczane_id, (veri->>'durum'));
