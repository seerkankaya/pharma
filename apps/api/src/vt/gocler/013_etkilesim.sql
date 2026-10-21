-- Eczanenin eklediği ilaç-ilaç etkileşim kuralları. Örnek kurallar kodda durur, tabloya yazılmaz.
create table etkilesim_kurali (
  eczane_id uuid not null references eczane,
  id text not null,
  veri jsonb not null,
  guncelleme timestamptz not null default now(),
  primary key (eczane_id, id)
);
