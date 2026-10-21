-- ÖKC fişleri: her satışın kesilen fişi, fiş ve Z numarası, kartlı satışta POS onay kodu.
create table okc_fis (
  eczane_id uuid not null references eczane,
  id text not null,
  veri jsonb not null,
  guncelleme timestamptz not null default now(),
  primary key (eczane_id, id)
);
