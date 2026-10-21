-- Gelir-gider kayıtları. Yalnızca eklenir; yanlış kayıt iptal kaydıyla düzeltilir.
create table kasa_hareketi (
  eczane_id uuid not null references eczane,
  id text not null,
  veri jsonb not null,
  guncelleme timestamptz not null default now(),
  primary key (eczane_id, id)
);
create index kasa_hareketi_tarih on kasa_hareketi (eczane_id, (veri->>'tarih'));

create trigger kasa_hareketi_degismez before update or delete on kasa_hareketi
  for each row execute function degistirilemez();
create trigger kasa_hareketi_bosaltilamaz before truncate on kasa_hareketi
  for each statement execute function degistirilemez();
