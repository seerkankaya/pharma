-- Kasa kapanışı: her eczane her günü bir kez kapatır. Kayıt değiştirilmez ve silinmez.
create table gun_sonu (
  eczane_id uuid not null references eczane,
  gun date not null,
  kullanici_id uuid not null references kullanici,
  zaman timestamptz not null,
  sayilan_nakit_kurus integer not null check (sayilan_nakit_kurus >= 0),
  fark_kurus integer not null,
  veri jsonb not null,
  primary key (eczane_id, gun)
);

create trigger gun_sonu_degismez before update or delete on gun_sonu
  for each row execute function degistirilemez();
create trigger gun_sonu_bosaltilamaz before truncate on gun_sonu
  for each statement execute function degistirilemez();
