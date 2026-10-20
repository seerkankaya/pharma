-- Tedarikçiler (ecza depoları) ve alış faturaları.
create table tedarikci (
  id uuid primary key default gen_random_uuid(),
  eczane_id uuid not null references eczane,
  ad text not null,
  vergi_no text,
  telefon text,
  olusturma timestamptz not null default now()
);
create index tedarikci_eczane on tedarikci (eczane_id);

-- Fatura yalnızca eklenir; aynı tedarikçiden aynı numaralı fatura iki kez girilemez.
create table alis_faturasi (
  id uuid primary key,
  eczane_id uuid not null references eczane,
  tedarikci_id uuid not null references tedarikci,
  fatura_no text not null,
  zaman timestamptz not null,
  veri jsonb not null,
  unique (eczane_id, tedarikci_id, fatura_no)
);
create index alis_faturasi_eczane on alis_faturasi (eczane_id, zaman);

create trigger alis_faturasi_degismez before update or delete on alis_faturasi
  for each row execute function degistirilemez();
create trigger alis_faturasi_bosaltilamaz before truncate on alis_faturasi
  for each statement execute function degistirilemez();

-- Stok girişi bir faturadan geldiyse hangisinden geldiği tutulur.
alter table stok_hareketi add column fatura_id uuid references alis_faturasi;
