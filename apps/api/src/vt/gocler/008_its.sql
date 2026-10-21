-- İlaç Takip Sistemi: her ilaç kutusu (GTIN + seri no) ve İTS'ye gidecek bildirim kuyruğu.
-- Yeni modüllerin tabloları aynı yapıdadır: belge JSON olarak tutulur (bkz. vt/pg-belge-deposu.ts).
create table its_tekil (
  eczane_id uuid not null references eczane,
  id text not null,
  veri jsonb not null,
  guncelleme timestamptz not null default now(),
  primary key (eczane_id, id)
);
create index its_tekil_barkod on its_tekil (eczane_id, (veri->>'barkod'));

create table its_bildirim (
  eczane_id uuid not null references eczane,
  id text not null,
  veri jsonb not null,
  guncelleme timestamptz not null default now(),
  primary key (eczane_id, id)
);
create index its_bildirim_durum on its_bildirim (eczane_id, (veri->>'durum'));
