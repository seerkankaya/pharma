-- Ecza deposuna iade ve depo ödemeleri. Depo carisi bu iki tablo ile alış faturalarından hesaplanır.
-- Stok hareketlerine depoya iade türü eklenir.
alter table stok_hareketi drop constraint stok_hareketi_tur_check;
alter table stok_hareketi add constraint stok_hareketi_tur_check check (tur in ('giris', 'satis', 'imha', 'iade'));

create table depo_iade (
  eczane_id uuid not null references eczane,
  id text not null,
  veri jsonb not null,
  guncelleme timestamptz not null default now(),
  primary key (eczane_id, id)
);
create unique index depo_iade_belge on depo_iade (eczane_id, (veri->>'tedarikciId'), (veri->>'belgeNo'));

create table depo_odeme (
  eczane_id uuid not null references eczane,
  id text not null,
  veri jsonb not null,
  guncelleme timestamptz not null default now(),
  primary key (eczane_id, id)
);

-- İade ve ödeme kayıtları yalnızca eklenir.
create trigger depo_iade_degismez before update or delete on depo_iade
  for each row execute function degistirilemez();
create trigger depo_iade_bosaltilamaz before truncate on depo_iade
  for each statement execute function degistirilemez();
create trigger depo_odeme_degismez before update or delete on depo_odeme
  for each row execute function degistirilemez();
create trigger depo_odeme_bosaltilamaz before truncate on depo_odeme
  for each statement execute function degistirilemez();
