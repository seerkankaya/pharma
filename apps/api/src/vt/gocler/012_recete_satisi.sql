-- Reçeteli satış, SGK dönem icmali, kurum tahsilatları ve eczane ayarları.
-- Reçeteyle verilen ilaç stoktan "recete" hareketiyle düşer.
alter table stok_hareketi drop constraint stok_hareketi_tur_check;
alter table stok_hareketi add constraint stok_hareketi_tur_check check (tur in ('giris', 'satis', 'imha', 'iade', 'emanet', 'recete'));

create table recete_satisi (
  eczane_id uuid not null references eczane,
  id text not null,
  veri jsonb not null,
  guncelleme timestamptz not null default now(),
  primary key (eczane_id, id)
);
create index recete_satisi_tarih on recete_satisi (eczane_id, (veri->>'tarih'));

create table icmal (
  eczane_id uuid not null references eczane,
  id text not null,
  veri jsonb not null,
  guncelleme timestamptz not null default now(),
  primary key (eczane_id, id)
);

create table kurum_tahsilat (
  eczane_id uuid not null references eczane,
  id text not null,
  veri jsonb not null,
  guncelleme timestamptz not null default now(),
  primary key (eczane_id, id)
);
create trigger kurum_tahsilat_degismez before update or delete on kurum_tahsilat
  for each row execute function degistirilemez();
create trigger kurum_tahsilat_bosaltilamaz before truncate on kurum_tahsilat
  for each statement execute function degistirilemez();

create table eczane_ayar (
  eczane_id uuid not null references eczane,
  id text not null,
  veri jsonb not null,
  guncelleme timestamptz not null default now(),
  primary key (eczane_id, id)
);
