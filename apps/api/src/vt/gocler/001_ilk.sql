-- Eczaneler ve kullanıcılar
create table eczane (
  id uuid primary key default gen_random_uuid(),
  ad text not null,
  olusturma timestamptz not null default now()
);

create table kullanici (
  id uuid primary key default gen_random_uuid(),
  eczane_id uuid not null references eczane,
  eposta text not null unique,
  ad_soyad text not null,
  rol text not null check (rol in ('eczaci', 'calisan')),
  kural_yetkisi boolean not null default false,
  aktif boolean not null default true,
  parola_ozeti text not null,
  olusturma timestamptz not null default now()
);
create index kullanici_eczane on kullanici (eczane_id);

-- Tarayıcıdaki belirtecin yalnızca SHA-256 özeti tutulur.
create table oturum (
  belirtec_ozeti text primary key,
  kullanici_id uuid not null references kullanici on delete cascade,
  bitis timestamptz not null
);
create index oturum_bitis on oturum (bitis);

-- Ortak SUT kural kitaplığı. Kural, sut-motoru'ndaki IlacKurali biçiminde saklanır.
create table ilac_kurali (
  id text primary key,
  veri jsonb not null check (veri ->> 'id' = id),
  guncelleme timestamptz not null default now()
);

-- Onaylı kural silinemez; değişebilecek tek alan, henüz kapatılmamışsa geçerlilik bitişidir.
-- Uygulama da aynı kuralı uygular; bu tetikleyici, uygulamadaki bir hataya karşı ikinci kilittir.
create function ilac_kurali_koru() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.veri ? 'onay' then
      raise exception 'Onaylı kural silinemez: %', old.id;
    end if;
    return old;
  end if;
  if old.veri ? 'onay' and new.veri is distinct from old.veri then
    if old.veri #> '{gecerlilik,bitis}' is not null
       or (new.veri #- '{gecerlilik,bitis}') is distinct from (old.veri #- '{gecerlilik,bitis}') then
      raise exception 'Onaylı kural değiştirilemez: %', old.id;
    end if;
  end if;
  new.guncelleme := now();
  return new;
end $$;
create trigger ilac_kurali_koru before update or delete on ilac_kurali
  for each row execute function ilac_kurali_koru();

-- Kontrol edilen reçeteler. Gönderim yalnızca buradaki kayıt üzerinden yapılır.
create table kontrol (
  id uuid primary key,
  eczane_id uuid not null references eczane,
  kullanici_id uuid not null references kullanici,
  recete jsonb not null,
  sonuc jsonb not null,
  durum text not null default 'bekliyor' check (durum in ('bekliyor', 'gonderiliyor', 'gonderildi')),
  takip_no text,
  olusturma timestamptz not null default now()
);
create index kontrol_eczane on kontrol (eczane_id, olusturma);

-- Denetim kaydı: yalnızca eklenir. Değiştirme, silme ve boşaltma veritabanında engellidir.
create table denetim (
  sira bigserial primary key,
  eczane_id uuid not null references eczane,
  kontrol_id uuid not null unique references kontrol,
  zaman timestamptz not null,
  kayit jsonb not null
);
create index denetim_eczane on denetim (eczane_id, sira);

create function denetim_degismez() returns trigger language plpgsql as $$
begin
  raise exception 'Denetim kaydı değiştirilemez ve silinemez';
end $$;
create trigger denetim_degismez before update or delete on denetim
  for each row execute function denetim_degismez();
create trigger denetim_bosaltilamaz before truncate on denetim
  for each statement execute function denetim_degismez();
