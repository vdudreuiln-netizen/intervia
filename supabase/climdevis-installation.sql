-- =============================================================================
-- ClimDevis — installation complète de la base (à coller en une fois dans
-- Supabase › SQL Editor › New query, puis « Run »). À exécuter UNE SEULE FOIS
-- sur un projet neuf. Fichier généré par `npm run sql:bundle` : ne pas modifier
-- à la main, modifiez les fichiers de supabase/migrations/.
-- =============================================================================
-- >>>>> 20261114000001_schema.sql
-- =============================================================================
-- ClimDevis — schéma initial
-- Multi-entreprise : chaque ligne métier porte company_id, et la RLS limite
-- tout accès à l'entreprise de l'utilisateur connecté.
-- Montants en CENTIMES (bigint), taux en décimal (0.2 = 20 %).
-- =============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------
create type vat_regime as enum ('franchise', 'assujetti');
create type product_type as enum (
  'ue_mono', 'ue_multi', 'ui_murale', 'ui_console', 'ui_cassette', 'ui_gainable', 'accessoire'
);
create type insulation_level as enum ('faible', 'moyenne', 'bonne', 'rt2012');
create type orientation as enum ('N', 'E', 'S', 'O', 'aucune');
create type quote_status as enum ('brouillon', 'envoye', 'accepte', 'refuse');
create type quote_presentation as enum ('particulier', 'detaille');
create type line_kind as enum ('material', 'accessory', 'labor', 'travel', 'other');
create type member_role as enum ('owner', 'member');

-- ---------------------------------------------------------------------------
-- Entreprises et utilisateurs
-- ---------------------------------------------------------------------------
create table companies (
  id                    uuid primary key default gen_random_uuid(),
  legal_name            text not null,
  siret                 text check (siret is null or siret ~ '^[0-9]{14}$'),
  address_line          text,
  postal_code           text,
  city                  text,
  phone                 text,
  email                 text,
  logo_path             text,       -- chemin dans le bucket "company-assets"
  stamp_path            text,       -- tampon / signature
  -- Assurance décennale
  insurer_name          text,
  insurance_policy      text,
  insurance_coverage    text,       -- zone géographique couverte (mention obligatoire)
  -- RIB
  bank_holder           text,
  iban                  text,
  bic                   text,
  -- TVA
  vat_regime            vat_regime not null default 'franchise',
  vat_number            text,
  default_vat_rate      numeric(4,3) not null default 0.100 check (default_vat_rate in (0.055, 0.1, 0.2)),
  -- Charges sociales (en % du CA HT)
  labor_charges_rate    numeric(5,4) not null default 0.2120 check (labor_charges_rate between 0 and 1),
  material_charges_rate numeric(5,4) not null default 0.1230 check (material_charges_rate between 0 and 1),
  -- Main d'œuvre et marge
  daily_labor_rate_cents        bigint not null default 45000 check (daily_labor_rate_cents >= 0),
  target_margin_per_day_cents   bigint not null default 30000 check (target_margin_per_day_cents >= 0),
  -- Déplacement
  base_address          text,
  base_postal_code      text,
  base_city             text,
  base_citycode         text,       -- code INSEE : détection « chantier dans la commune »
  base_lat              double precision,
  base_lng              double precision,
  travel_price_per_km_cents   integer not null default 50 check (travel_price_per_km_cents >= 0),
  travel_minimum_fee_cents    integer not null default 3000 check (travel_minimum_fee_cents >= 0),
  -- stationnement : activé chantier par chantier ; ici la valeur proposée par défaut
  parking_per_day_cents       integer not null default 0 check (parking_per_day_cents >= 0),
  -- minimum par jour « déplacement + stationnement » quand le stationnement est activé
  travel_min_daily_with_parking_cents integer not null default 0 check (travel_min_daily_with_parking_cents >= 0),
  -- Conditions des devis
  quote_validity_days   integer not null default 30 check (quote_validity_days > 0),
  payment_terms         text not null default 'Acompte de 30 % à la signature, solde à la fin des travaux.',
  onboarding_done       boolean not null default false,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- "users" : profil applicatif rattaché à auth.users
create table profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  company_id  uuid not null references companies(id) on delete cascade,
  full_name   text,
  role        member_role not null default 'owner',
  created_at  timestamptz not null default now()
);
create index on profiles (company_id);

-- Abonnement : écrit uniquement par le webhook Stripe (service_role)
create table subscriptions (
  company_id             uuid primary key references companies(id) on delete cascade,
  status                 text not null default 'trialing',   -- trialing | active | past_due | canceled | expired
  trial_ends_at          timestamptz not null default (now() + interval '14 days'),
  stripe_customer_id     text unique,
  stripe_subscription_id text unique,
  current_period_end     timestamptz,
  updated_at             timestamptz not null default now()
);

-- Coefficients de dimensionnement et de main d'œuvre (modifiables)
create table settings_coefficients (
  company_id  uuid primary key references companies(id) on delete cascade,
  sizing      jsonb not null,  -- cf. SizingCoefficients (src/lib/sizing/sizing.ts)
  labor_days  jsonb not null,  -- cf. LaborDaysParams
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Catalogue
-- ---------------------------------------------------------------------------
create table brands (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references companies(id) on delete cascade,
  name         text not null,
  discount_rate numeric(5,4) not null default 0 check (discount_rate >= 0 and discount_rate < 1),
  -- prix de vente = prix public × coefficient (1,00 = prix public)
  sale_coefficient numeric(4,3) not null default 1.000 check (sale_coefficient > 0 and sale_coefficient <= 5),
  is_example   boolean not null default false,
  created_at   timestamptz not null default now(),
  unique (company_id, name)
);

create table products (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references companies(id) on delete cascade,
  brand_id           uuid not null references brands(id) on delete cascade,
  range_name         text,
  reference          text not null,
  type               product_type not null,
  cooling_kw         numeric(5,2) check (cooling_kw is null or cooling_kw > 0),
  heating_kw         numeric(5,2) check (heating_kw is null or heating_kw > 0),
  max_outlets        smallint check (max_outlets is null or max_outlets between 1 and 8),
  -- multi-split : Σ puissances intérieures / puissance extérieure maxi (doc fabricant, 1,30 par défaut)
  max_indoor_ratio   numeric(4,2) check (max_indoor_ratio is null or max_indoor_ratio between 1 and 2),
  public_price_cents bigint not null check (public_price_cents >= 0),
  -- remise propre au produit : NULL = on prend celle de la marque
  discount_rate      numeric(5,4) check (discount_rate is null or (discount_rate >= 0 and discount_rate < 1)),
  is_example         boolean not null default false,
  active             boolean not null default true,
  created_at         timestamptz not null default now(),
  unique (company_id, brand_id, reference)
);
create index on products (company_id, type) where active;

create table accessories (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references companies(id) on delete cascade,
  category           text not null,  -- liaison, goulotte, support, pompe, condensats, electricite, gaz, autre
  name               text not null,
  diameter           text,           -- ex. '1/4 - 3/8' pour les liaisons
  unit               text not null default 'u' check (unit in ('u', 'm', 'kg', 'forfait')),
  public_price_cents bigint not null check (public_price_cents >= 0),
  discount_rate      numeric(5,4) not null default 0 check (discount_rate >= 0 and discount_rate < 1),
  is_example         boolean not null default false,
  active             boolean not null default true,
  created_at         timestamptz not null default now()
);
create index on accessories (company_id, category) where active;

-- ---------------------------------------------------------------------------
-- Clients, projets, pièces
-- ---------------------------------------------------------------------------
create table clients (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  name        text not null,
  email       text,
  phone       text,
  address_line text,
  postal_code text,
  city        text,
  created_at  timestamptz not null default now()
);
create index on clients (company_id);

create table projects (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references companies(id) on delete cascade,
  client_id      uuid not null references clients(id) on delete restrict,
  site_address   text,
  site_postal_code text,
  site_city      text,
  site_citycode  text,
  site_lat       double precision,
  site_lng       double precision,
  one_way_km     numeric(6,1),
  same_commune   boolean not null default false,
  parking_enabled boolean not null default false,
  parking_per_day_cents integer check (parking_per_day_cents is null or parking_per_day_cents >= 0),
  created_at     timestamptz not null default now()
);
create index on projects (company_id);

create table rooms (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references companies(id) on delete cascade,
  project_id       uuid not null references projects(id) on delete cascade,
  position         smallint not null default 0,
  name             text not null,
  surface_m2       numeric(6,2) not null check (surface_m2 > 0),
  ceiling_height_m numeric(4,2) not null default 2.50 check (ceiling_height_m > 0),
  orientation      orientation not null default 'aucune',
  insulation       insulation_level not null default 'moyenne',
  large_glazing    boolean not null default false,
  under_roof       boolean not null default false,
  need_watts       integer,          -- résultat du dimensionnement (instantané)
  need_override_watts integer        -- si l'artisan force une valeur
);
create index on rooms (project_id);

-- ---------------------------------------------------------------------------
-- Devis
-- ---------------------------------------------------------------------------
create table quote_counters (
  company_id  uuid not null references companies(id) on delete cascade,
  year        smallint not null,
  last_number integer not null default 0,
  primary key (company_id, year)
);

create table quotes (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references companies(id) on delete cascade,
  project_id       uuid not null references projects(id) on delete cascade,
  number           text not null,     -- D-2026-001 (attribué par trigger)
  status           quote_status not null default 'brouillon',
  presentation     quote_presentation not null default 'particulier',
  vat_regime       vat_regime not null,           -- figé à la création
  issue_date       date not null default current_date,
  validity_days    integer not null default 30,
  payment_terms    text,
  labor_days       numeric(4,1) not null default 0,
  travel_trips     numeric(4,1) not null default 0,
  -- coefficient de vente propre au devis : remplace celui des marques s'il est renseigné
  sale_coefficient numeric(4,3) check (sale_coefficient is null or (sale_coefficient > 0 and sale_coefficient <= 5)),
  notes            text,
  -- instantané du moteur de calcul (pour le tableau de bord)
  total_ht_cents   bigint not null default 0,
  total_ttc_cents  bigint not null default 0,
  net_margin_cents bigint not null default 0,
  sent_at          timestamptz,
  decided_at       timestamptz,
  duplicated_from  uuid references quotes(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (company_id, number)
);
create index on quotes (company_id, status, issue_date desc);

create table quote_lines (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies(id) on delete cascade,
  quote_id            uuid not null references quotes(id) on delete cascade,
  position            smallint not null default 0,
  kind                line_kind not null,
  product_id          uuid references products(id) on delete set null,
  accessory_id        uuid references accessories(id) on delete set null,
  room_id             uuid references rooms(id) on delete set null,
  designation         text not null,
  quantity            numeric(8,2) not null check (quantity >= 0),
  unit                text not null default 'u',
  unit_purchase_cents bigint not null default 0 check (unit_purchase_cents >= 0),
  unit_sale_cents     bigint not null check (unit_sale_cents >= 0),
  vat_rate            numeric(4,3) not null default 0.2 check (vat_rate in (0, 0.055, 0.1, 0.2))
);
create index on quote_lines (quote_id, position);

-- ---------------------------------------------------------------------------
-- Fonctions
-- ---------------------------------------------------------------------------

-- Entreprise de l'utilisateur connecté (utilisée par toutes les policies).
create or replace function public.current_company_id()
returns uuid language sql stable security definer set search_path = public as $$
  select company_id from profiles where id = auth.uid()
$$;

-- Numérotation D-AAAA-NNN, sans trou ni doublon même en concurrence.
create or replace function public.assign_quote_number()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  y smallint := extract(year from coalesce(new.issue_date, current_date));
  n integer;
begin
  insert into quote_counters (company_id, year, last_number) values (new.company_id, y, 1)
  on conflict (company_id, year) do update set last_number = quote_counters.last_number + 1
  returning last_number into n;
  new.number := format('D-%s-%s', y, lpad(n::text, 3, '0'));
  return new;
end $$;

create trigger quotes_assign_number before insert on quotes
  for each row execute function public.assign_quote_number();

-- Le numéro et l'entreprise d'un devis ne changent jamais.
create or replace function public.protect_quote_identity()
returns trigger language plpgsql as $$
begin
  if new.number <> old.number or new.company_id <> old.company_id then
    raise exception 'Le numéro et l''entreprise d''un devis ne peuvent pas être modifiés';
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger quotes_protect_identity before update on quotes
  for each row execute function public.protect_quote_identity();

-- Vérifie que les références d'une ligne / pièce / projet appartiennent à la même entreprise.
create or replace function public.check_same_company()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'quote_lines' then
    if not exists (select 1 from quotes where id = new.quote_id and company_id = new.company_id) then
      raise exception 'Devis inconnu pour cette entreprise';
    end if;
  elsif tg_table_name = 'rooms' or tg_table_name = 'quotes' then
    if not exists (select 1 from projects where id = new.project_id and company_id = new.company_id) then
      raise exception 'Projet inconnu pour cette entreprise';
    end if;
  elsif tg_table_name = 'projects' then
    if not exists (select 1 from clients where id = new.client_id and company_id = new.company_id) then
      raise exception 'Client inconnu pour cette entreprise';
    end if;
  elsif tg_table_name = 'products' then
    if not exists (select 1 from brands where id = new.brand_id and company_id = new.company_id) then
      raise exception 'Marque inconnue pour cette entreprise';
    end if;
  end if;
  return new;
end $$;

create trigger quote_lines_same_company before insert or update on quote_lines for each row execute function public.check_same_company();
create trigger rooms_same_company       before insert or update on rooms       for each row execute function public.check_same_company();
create trigger quotes_same_company      before insert or update on quotes      for each row execute function public.check_same_company();
create trigger projects_same_company    before insert or update on projects    for each row execute function public.check_same_company();
create trigger products_same_company    before insert or update on products    for each row execute function public.check_same_company();

-- ---------------------------------------------------------------------------
-- Row-Level Security : chaque entreprise ne voit que ses données
-- ---------------------------------------------------------------------------
alter table companies             enable row level security;
alter table profiles              enable row level security;
alter table subscriptions         enable row level security;
alter table settings_coefficients enable row level security;
alter table brands                enable row level security;
alter table products              enable row level security;
alter table accessories           enable row level security;
alter table clients               enable row level security;
alter table projects              enable row level security;
alter table rooms                 enable row level security;
alter table quote_counters        enable row level security;
alter table quotes                enable row level security;
alter table quote_lines           enable row level security;

create policy companies_select on companies for select using (id = current_company_id());
create policy companies_update on companies for update using (id = current_company_id()) with check (id = current_company_id());

create policy profiles_select on profiles for select using (company_id = current_company_id());
create policy profiles_update_self on profiles for update using (id = auth.uid()) with check (company_id = current_company_id());

-- lecture seule : écrit par le webhook Stripe avec la clé service_role
create policy subscriptions_select on subscriptions for select using (company_id = current_company_id());
-- lecture seule : alimenté par le trigger de numérotation
create policy quote_counters_select on quote_counters for select using (company_id = current_company_id());

do $$
declare t text;
begin
  foreach t in array array['settings_coefficients','brands','products','accessories','clients','projects','rooms','quotes','quote_lines'] loop
    execute format('create policy %1$s_all on %1$s for all using (company_id = current_company_id()) with check (company_id = current_company_id())', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Stockage : logos et tampons, rangés sous {company_id}/...
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public) values ('company-assets', 'company-assets', false)
on conflict (id) do nothing;

create policy company_assets_rw on storage.objects for all
  using (bucket_id = 'company-assets' and (storage.foldername(name))[1] = current_company_id()::text)
  with check (bucket_id = 'company-assets' and (storage.foldername(name))[1] = current_company_id()::text);

-- >>>>> 20261114000002_onboarding_and_example_catalog.sql
-- =============================================================================
-- Création de l'entreprise à l'inscription + catalogue exemple
-- =============================================================================

-- Catalogue d'exemple : 4 marques FICTIVES, prix FICTIFS (ordres de grandeur
-- réalistes), clairement marqués « Exemple ». L'artisan peut tout supprimer.
create or replace function public.seed_example_catalog(p_company_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  b record;
  brand_id uuid;
begin
  for b in
    select * from (values
      ('Exemple – Arctica', 0.35::numeric, 1.00::numeric),
      ('Exemple – Boréal',  0.40,          0.92),
      ('Exemple – Cyclone', 0.30,          1.12),
      ('Exemple – Dalia',   0.38,          0.85)
    ) as t(name, discount, price_factor)
  loop
    insert into brands (company_id, name, discount_rate, is_example)
    values (p_company_id, b.name, b.discount, true)
    returning id into brand_id;

    insert into products (company_id, brand_id, range_name, reference, type, cooling_kw, heating_kw, max_outlets, max_indoor_ratio, public_price_cents, is_example)
    select p_company_id, brand_id, p.range_name,
           upper(left(split_part(b.name, '– ', 2), 3)) || '-' || p.ref,
           p.type::product_type, p.cool, p.heat, p.outlets,
           case when p.type = 'ue_multi' then 1.30 end,
           (round(p.price * b.price_factor / 10) * 10 * 100)::bigint,
           true
    from (values
      -- unités extérieures mono-split
      ('Confort',  'UE25',  'ue_mono',     2.5,  3.2, 1, 890),
      ('Confort',  'UE35',  'ue_mono',     3.5,  4.0, 1, 1090),
      ('Confort',  'UE50',  'ue_mono',     5.0,  5.8, 1, 1590),
      ('Confort',  'UE71',  'ue_mono',     7.1,  8.2, 1, 2290),
      -- unités extérieures multi-split
      ('Multi',    'M2-50', 'ue_multi',    5.0,  5.6, 2, 1990),
      ('Multi',    'M3-68', 'ue_multi',    6.8,  8.6, 3, 2790),
      ('Multi',    'M4-80', 'ue_multi',    8.0,  9.4, 4, 3390),
      ('Multi',    'M5-100','ue_multi',   10.0, 12.0, 5, 4290),
      -- unités intérieures murales
      ('Confort',  'MU20',  'ui_murale',   2.0,  2.5, null, 420),
      ('Confort',  'MU25',  'ui_murale',   2.5,  3.2, null, 460),
      ('Confort',  'MU35',  'ui_murale',   3.5,  4.0, null, 540),
      ('Confort',  'MU50',  'ui_murale',   5.0,  5.8, null, 790),
      ('Confort',  'MU71',  'ui_murale',   7.1,  8.2, null, 1090),
      -- consoles
      ('Confort',  'CO25',  'ui_console',  2.5,  3.4, null, 690),
      ('Confort',  'CO35',  'ui_console',  3.5,  4.5, null, 790),
      -- cassettes
      ('Pro',      'CA35',  'ui_cassette', 3.5,  4.0, null, 990),
      ('Pro',      'CA50',  'ui_cassette', 5.0,  6.0, null, 1190),
      -- gainables
      ('Pro',      'GA35',  'ui_gainable', 3.5,  4.0, null, 1190),
      ('Pro',      'GA50',  'ui_gainable', 5.0,  6.0, null, 1390),
      ('Pro',      'GA71',  'ui_gainable', 7.1,  8.0, null, 1790),
      ('Pro',      'GA100', 'ui_gainable',10.0, 11.2, null, 2390)
    ) as p(range_name, ref, type, cool, heat, outlets, price);
  end loop;

  insert into accessories (company_id, category, name, diameter, unit, public_price_cents, discount_rate, is_example)
  values
    (p_company_id, 'liaison',     'Liaison frigorifique isolée',            '1/4 - 3/8', 'm',  1200, 0.30, true),
    (p_company_id, 'liaison',     'Liaison frigorifique isolée',            '1/4 - 1/2', 'm',  1500, 0.30, true),
    (p_company_id, 'liaison',     'Liaison frigorifique isolée',            '3/8 - 5/8', 'm',  2200, 0.30, true),
    (p_company_id, 'goulotte',    'Goulotte de finition 80 × 60',           null,        'm',  1400, 0.25, true),
    (p_company_id, 'goulotte',    'Coude / accessoire de goulotte',         null,        'u',   900, 0.25, true),
    (p_company_id, 'support',     'Support mural unité extérieure',         null,        'u',  4500, 0.25, true),
    (p_company_id, 'support',     'Support sol (silent-blocs) unité extérieure', null,   'u',  6000, 0.25, true),
    (p_company_id, 'pompe',       'Pompe de relevage des condensats',       null,        'u', 12000, 0.25, true),
    (p_company_id, 'condensats',  'Tube d''évacuation des condensats',      '16 mm',     'm',   250, 0.25, true),
    (p_company_id, 'electricite', 'Câble d''alimentation 3G2,5',            null,        'm',   280, 0.25, true),
    (p_company_id, 'electricite', 'Câble de liaison 4G1,5',                 null,        'm',   220, 0.25, true),
    (p_company_id, 'electricite', 'Disjoncteur 16 A courbe D',              null,        'u',  1800, 0.25, true),
    (p_company_id, 'electricite', 'Disjoncteur 20 A courbe D',              null,        'u',  2000, 0.25, true),
    (p_company_id, 'gaz',         'Fluide R32 (complément de charge)',      null,        'kg', 4500, 0.20, true);
end $$;

-- Valeurs par défaut des coefficients (identiques à DEFAULT_SIZING / DEFAULT_LABOR_DAYS).
create or replace function public.default_sizing_coefficients()
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'wattsPerM3',  jsonb_build_object('faible', 45, 'moyenne', 38, 'bonne', 32, 'rt2012', 25),
    'orientation', jsonb_build_object('N', 0.9, 'E', 1.0, 'S', 1.1, 'O', 1.15, 'aucune', 1.0),
    'underRoof', 1.2, 'largeGlazing', 1.15, 'unitMinRatio', 0.95, 'unitMaxRatio', 1.6)
$$;

create or replace function public.default_labor_days()
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'perOutdoorUnit', 0.25,
    'perIndoorUnit', jsonb_build_object('mural', 0.5, 'console', 0.5, 'cassette', 0.75, 'gainable', 1.5),
    'perExtraLinkMeter', 0.02, 'includedLinkMetersPerIndoor', 5, 'commissioning', 0.25, 'roundTo', 0.5)
$$;

-- Appelé une fois par l'utilisateur connecté au début de l'onboarding.
create or replace function public.create_company_for_current_user(p_legal_name text, p_full_name text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  cid uuid;
begin
  if auth.uid() is null then
    raise exception 'Non authentifié';
  end if;
  select company_id into cid from profiles where id = auth.uid();
  if cid is not null then
    return cid; -- idempotent
  end if;

  insert into companies (legal_name, email)
  values (coalesce(nullif(trim(p_legal_name), ''), 'Mon entreprise'), (select email from auth.users where id = auth.uid()))
  returning id into cid;

  insert into profiles (id, company_id, full_name, role) values (auth.uid(), cid, p_full_name, 'owner');
  insert into subscriptions (company_id) values (cid);
  insert into settings_coefficients (company_id, sizing, labor_days)
  values (cid, default_sizing_coefficients(), default_labor_days());
  perform seed_example_catalog(cid);
  return cid;
end $$;

revoke all on function public.create_company_for_current_user(text, text) from public, anon;
grant execute on function public.create_company_for_current_user(text, text) to authenticated;
revoke all on function public.seed_example_catalog(uuid) from public, anon, authenticated;

-- >>>>> 20261114000003_catalog_import.sql
-- =============================================================================
-- Étape 3 : catalogue — fournisseurs, import de tarifs, historique des prix,
-- coefficient de vente des accessoires.
-- =============================================================================

-- Coefficient de vente des accessoires : prix de vente = prix d'achat × coefficient.
alter table companies add column accessory_sale_coefficient numeric(4,3) not null default 1.300
  check (accessory_sale_coefficient > 0 and accessory_sale_coefficient <= 5);
alter table quotes add column accessory_sale_coefficient numeric(4,3)
  check (accessory_sale_coefficient is null or (accessory_sale_coefficient > 0 and accessory_sale_coefficient <= 5));

-- Fournisseurs (distributeurs) : on y mémorise la dernière correspondance de colonnes.
create table suppliers (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references companies(id) on delete cascade,
  name            text not null,
  -- { "materiel": { "reference": "Code article", ... }, "accessoires": { ... } }
  column_mapping  jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  unique (company_id, name)
);

alter table products    add column supplier_id uuid references suppliers(id) on delete set null;
alter table accessories add column supplier_id uuid references suppliers(id) on delete set null;
alter table accessories add column reference text;
create unique index accessories_company_reference on accessories (company_id, reference) where reference is not null;

-- Journal des imports
create table catalog_imports (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  supplier_id   uuid references suppliers(id) on delete set null,
  target        text not null check (target in ('materiel', 'accessoires')),
  filename      text,
  created_count integer not null default 0,
  updated_count integer not null default 0,
  created_at    timestamptz not null default now()
);

-- Historique des prix : alimenté automatiquement par trigger (import OU saisie manuelle).
create table price_history (
  id                     uuid primary key default gen_random_uuid(),
  company_id             uuid not null references companies(id) on delete cascade,
  product_id             uuid references products(id) on delete cascade,
  accessory_id           uuid references accessories(id) on delete cascade,
  old_public_price_cents bigint,
  new_public_price_cents bigint not null,
  old_discount_rate      numeric(5,4),
  new_discount_rate      numeric(5,4),
  import_id              uuid references catalog_imports(id) on delete set null,
  changed_at             timestamptz not null default now(),
  check ((product_id is null) <> (accessory_id is null))
);
create index on price_history (product_id, changed_at desc);
create index on price_history (accessory_id, changed_at desc);

create or replace function public.log_price_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  imp uuid := nullif(current_setting('climdevis.import_id', true), '')::uuid;
begin
  if tg_op = 'UPDATE'
     and new.public_price_cents is not distinct from old.public_price_cents
     and new.discount_rate is not distinct from old.discount_rate then
    return new;
  end if;
  insert into price_history (company_id, product_id, accessory_id, old_public_price_cents, new_public_price_cents, old_discount_rate, new_discount_rate, import_id)
  values (
    new.company_id,
    case when tg_table_name = 'products' then new.id end,
    case when tg_table_name = 'accessories' then new.id end,
    case when tg_op = 'UPDATE' then old.public_price_cents end,
    new.public_price_cents,
    case when tg_op = 'UPDATE' then old.discount_rate end,
    new.discount_rate,
    imp
  );
  return new;
end $$;

create trigger products_price_history after insert or update on products
  for each row execute function public.log_price_change();
create trigger accessories_price_history after insert or update on accessories
  for each row execute function public.log_price_change();

-- Le fournisseur d'un produit / accessoire doit appartenir à la même entreprise.
create or replace function public.check_supplier_company()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.supplier_id is not null and not exists (select 1 from suppliers where id = new.supplier_id and company_id = new.company_id) then
    raise exception 'Fournisseur inconnu pour cette entreprise';
  end if;
  return new;
end $$;
create trigger products_supplier_company before insert or update of supplier_id on products for each row execute function public.check_supplier_company();
create trigger accessories_supplier_company before insert or update of supplier_id on accessories for each row execute function public.check_supplier_company();

alter table suppliers       enable row level security;
alter table catalog_imports enable row level security;
alter table price_history   enable row level security;
create policy suppliers_all on suppliers for all using (company_id = current_company_id()) with check (company_id = current_company_id());
create policy catalog_imports_select on catalog_imports for select using (company_id = current_company_id());
create policy catalog_imports_insert on catalog_imports for insert with check (company_id = current_company_id());
create policy price_history_select on price_history for select using (company_id = current_company_id());

-- -----------------------------------------------------------------------------
-- Application d'un import, en UNE transaction (tout ou rien).
-- Le plan (créations / mises à jour) est calculé et validé côté serveur par
-- src/lib/catalog/import.ts ; cette fonction l'applique sous la RLS de l'appelant.
--
-- p_brands  : [{ "name": "...", "discount_rate": 0.35 | null }]  marques à créer si absentes
-- p_creates : [{ "brand": "...", "reference": "...", "type": "ue_mono", ... }]  (matériel)
--             [{ "reference": "...", "category": "...", "name": "...", ... }]   (accessoires)
-- p_updates : [{ "id": "...", "public_price_cents": 123, "discount_rate": 0.3 | absent, ... }]
-- -----------------------------------------------------------------------------
create or replace function public.apply_catalog_import(
  p_target text,
  p_supplier_name text,
  p_mapping jsonb,
  p_filename text,
  p_brands jsonb,
  p_creates jsonb,
  p_updates jsonb
) returns uuid language plpgsql security invoker set search_path = public as $$
declare
  cid uuid := current_company_id();
  sid uuid;
  imp uuid;
  r jsonb;
begin
  if cid is null then raise exception 'Non authentifié'; end if;
  if p_target not in ('materiel', 'accessoires') then raise exception 'Cible d''import invalide'; end if;

  insert into suppliers (company_id, name) values (cid, trim(p_supplier_name))
  on conflict (company_id, name) do nothing;
  select id into sid from suppliers where company_id = cid and name = trim(p_supplier_name);
  update suppliers set column_mapping = column_mapping || jsonb_build_object(p_target, p_mapping) where id = sid;

  insert into catalog_imports (company_id, supplier_id, target, filename, created_count, updated_count)
  values (cid, sid, p_target, p_filename, jsonb_array_length(p_creates), jsonb_array_length(p_updates))
  returning id into imp;
  perform set_config('climdevis.import_id', imp::text, true);

  if p_target = 'materiel' then
    insert into brands (company_id, name, discount_rate)
    select cid, b->>'name', coalesce((b->>'discount_rate')::numeric, 0)
    from jsonb_array_elements(p_brands) b
    on conflict (company_id, name) do nothing;

    insert into products (company_id, brand_id, supplier_id, range_name, reference, type, cooling_kw, heating_kw, max_outlets, max_indoor_ratio, public_price_cents, discount_rate)
    select cid, br.id, sid, r2->>'range_name', r2->>'reference', (r2->>'type')::product_type,
           (r2->>'cooling_kw')::numeric, (r2->>'heating_kw')::numeric, (r2->>'max_outlets')::smallint,
           (r2->>'max_indoor_ratio')::numeric, (r2->>'public_price_cents')::bigint, (r2->>'discount_rate')::numeric
    from jsonb_array_elements(p_creates) r2
    join brands br on br.company_id = cid and br.name = r2->>'brand';

    for r in select * from jsonb_array_elements(p_updates) loop
      update products set
        supplier_id        = sid,
        public_price_cents = (r->>'public_price_cents')::bigint,
        discount_rate      = case when r ? 'discount_rate' then (r->>'discount_rate')::numeric else discount_rate end,
        range_name         = coalesce(r->>'range_name', range_name),
        cooling_kw         = coalesce((r->>'cooling_kw')::numeric, cooling_kw),
        heating_kw         = coalesce((r->>'heating_kw')::numeric, heating_kw),
        max_outlets        = coalesce((r->>'max_outlets')::smallint, max_outlets),
        active             = true
      where id = (r->>'id')::uuid and company_id = cid;
    end loop;
  else
    insert into accessories (company_id, supplier_id, reference, category, name, diameter, unit, public_price_cents, discount_rate)
    select cid, sid, r2->>'reference', r2->>'category', r2->>'name', r2->>'diameter', coalesce(r2->>'unit', 'u'),
           (r2->>'public_price_cents')::bigint, coalesce((r2->>'discount_rate')::numeric, 0)
    from jsonb_array_elements(p_creates) r2;

    for r in select * from jsonb_array_elements(p_updates) loop
      update accessories set
        supplier_id        = sid,
        public_price_cents = (r->>'public_price_cents')::bigint,
        discount_rate      = case when r ? 'discount_rate' then (r->>'discount_rate')::numeric else discount_rate end,
        name               = coalesce(r->>'name', name),
        active             = true
      where id = (r->>'id')::uuid and company_id = cid;
    end loop;
  end if;

  return imp;
end $$;

revoke all on function public.apply_catalog_import(text, text, jsonb, text, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.apply_catalog_import(text, text, jsonb, text, jsonb, jsonb, jsonb) to authenticated;

-- >>>>> 20261114000004_quote_wizard.sql
-- =============================================================================
-- Étape 4 : assistant de devis — données techniques des unités, rôles des
-- accessoires ajoutés automatiquement, pièces, réglages de mise en service.
-- =============================================================================

-- Fiche produit : liaisons et charge de fluide (notice fabricant)
alter table products add column link_diameters text;                     -- ex. « 1/4 - 3/8 »
alter table products add column precharged_length_m numeric(5,1)
  check (precharged_length_m is null or precharged_length_m >= 0);      -- longueur pré-chargée de l'UE
alter table products add column extra_charge_g_per_m smallint
  check (extra_charge_g_per_m is null or extra_charge_g_per_m between 0 and 500); -- complément au mètre

-- Rôle d'un accessoire dans l'ajout automatique au devis
alter table accessories add column auto_role text check (auto_role is null or auto_role in (
  'liaison', 'support_mural', 'support_sol', 'goulotte', 'condensats', 'pompe_relevage',
  'cable_alim', 'cable_liaison', 'disjoncteur', 'gaz',
  'plenum', 'gaine', 'bouche_soufflage', 'grille_reprise',
  'registre_zonage', 'thermostat_zone', 'module_zonage'
));

-- Pièces : niveau (0 = RDC) et type d'unité intérieure souhaité
alter table rooms add column level smallint not null default 0 check (level between -1 and 5);
alter table rooms add column indoor_type text not null default 'mural' check (indoor_type in ('mural', 'console', 'cassette'));

-- Chantier : gainable possible ?
alter table projects add column gainable_access boolean not null default false;

-- Entreprise : marque préférée (option Premium), prestations de mise en service
alter table companies add column preferred_brand_id uuid references brands(id) on delete set null;
alter table companies add column commissioning_price_cents integer not null default 0 check (commissioning_price_cents >= 0);
alter table companies add column fluid_form_price_cents integer not null default 0 check (fluid_form_price_cents >= 0);
alter table companies add column fluid_form_policy text not null default 'complement' check (fluid_form_policy in ('complement', 'always'));
alter table companies add column default_electric_length_m numeric(5,1) not null default 10 check (default_electric_length_m >= 0);

-- Devis : état de l'assistant (sélection, métré, jours…) pour reprendre plus tard
alter table quotes add column wizard jsonb not null default '{}'::jsonb;
alter table quotes add column one_way_km numeric(6,1);

-- La marque préférée doit appartenir à l'entreprise
create or replace function public.check_preferred_brand()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.preferred_brand_id is not null and not exists (select 1 from brands where id = new.preferred_brand_id and company_id = new.id) then
    raise exception 'Marque inconnue pour cette entreprise';
  end if;
  return new;
end $$;
create trigger companies_preferred_brand before insert or update of preferred_brand_id on companies
  for each row execute function public.check_preferred_brand();

-- -----------------------------------------------------------------------------
-- Catalogue exemple : rôles, données techniques, accessoires gainable / zonage
-- -----------------------------------------------------------------------------
create or replace function public.seed_example_accessories_v2(p_company_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update accessories set auto_role = case
      when category = 'liaison' then 'liaison'
      when name like 'Support mural%' then 'support_mural'
      when name like 'Support sol%' then 'support_sol'
      when name like 'Goulotte%' then 'goulotte'
      when name like 'Pompe de relevage%' then 'pompe_relevage'
      when name like 'Tube d''évacuation%' then 'condensats'
      when name like 'Câble d''alimentation%' then 'cable_alim'
      when name like 'Câble de liaison%' then 'cable_liaison'
      when name like 'Disjoncteur 16 A%' then 'disjoncteur'
      when category = 'gaz' then 'gaz'
      else auto_role end
  where company_id = p_company_id and is_example;

  insert into accessories (company_id, category, name, diameter, unit, public_price_cents, discount_rate, is_example, auto_role) values
    (p_company_id, 'aeraulique', 'Plénum de soufflage isolé',            null,     'u',  9500, 0.25, true, 'plenum'),
    (p_company_id, 'aeraulique', 'Gaine souple isolée',                   'Ø 160',  'm',   900, 0.25, true, 'gaine'),
    (p_company_id, 'aeraulique', 'Bouche de soufflage linéaire',          null,     'u',  4500, 0.25, true, 'bouche_soufflage'),
    (p_company_id, 'aeraulique', 'Grille de reprise avec filtre',         null,     'u',  6500, 0.25, true, 'grille_reprise'),
    (p_company_id, 'zonage',     'Registre motorisé',                     'Ø 160',  'u', 14000, 0.25, true, 'registre_zonage'),
    (p_company_id, 'zonage',     'Thermostat d''ambiance de zone',        null,     'u',  9000, 0.25, true, 'thermostat_zone'),
    (p_company_id, 'zonage',     'Module de régulation de zonage',        null,     'u', 39000, 0.25, true, 'module_zonage');

  -- Données techniques fictives mais plausibles (à vérifier sur les notices réelles)
  update products set
    link_diameters = case
      when cooling_kw <= 3.5 then '1/4 - 3/8'
      when cooling_kw <= 5.0 then '1/4 - 1/2'
      else '3/8 - 5/8' end,
    precharged_length_m = case when type in ('ue_mono', 'ue_multi') then (case when type = 'ue_multi' then 30 else 7.5 end) end,
    extra_charge_g_per_m = case when type in ('ue_mono', 'ue_multi') then (case when cooling_kw >= 7 then 40 else 20 end) end
  where company_id = p_company_id and is_example and type <> 'accessoire';
end $$;

-- Entreprises existantes ayant encore le catalogue d'exemple
do $$
declare c record;
begin
  for c in select distinct company_id from accessories where is_example loop
    perform seed_example_accessories_v2(c.company_id);
  end loop;
end $$;

-- Nouvelles entreprises : on enchaîne les deux semences
create or replace function public.create_company_for_current_user(p_legal_name text, p_full_name text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  cid uuid;
begin
  if auth.uid() is null then
    raise exception 'Non authentifié';
  end if;
  select company_id into cid from profiles where id = auth.uid();
  if cid is not null then
    return cid;
  end if;

  insert into companies (legal_name, email)
  values (coalesce(nullif(trim(p_legal_name), ''), 'Mon entreprise'), (select email from auth.users where id = auth.uid()))
  returning id into cid;

  insert into profiles (id, company_id, full_name, role) values (auth.uid(), cid, p_full_name, 'owner');
  insert into subscriptions (company_id) values (cid);
  insert into settings_coefficients (company_id, sizing, labor_days)
  values (cid, default_sizing_coefficients(), default_labor_days());
  perform seed_example_catalog(cid);
  perform seed_example_accessories_v2(cid);
  return cid;
end $$;

revoke all on function public.seed_example_accessories_v2(uuid) from public, anon, authenticated;

-- >>>>> 20261114000005_quote_editing.sql
-- =============================================================================
-- Étape 5 : retouches du devis, remise commerciale, prix des accessoires,
-- fiche fluides par défaut, champs techniques à l'import.
-- =============================================================================

-- Accessoires : plancher « prix d'achat × coefficient » et accessoires sans prix public
alter table companies add column accessory_purchase_coefficient numeric(4,3) not null default 2.000
  check (accessory_purchase_coefficient > 0 and accessory_purchase_coefficient <= 5);
alter table accessories alter column public_price_cents drop not null;
alter table accessories add column purchase_price_cents bigint check (purchase_price_cents is null or purchase_price_cents >= 0);
alter table accessories add constraint accessories_has_a_price check (public_price_cents is not null or purchase_price_cents is not null);

-- Historique : un accessoire sans prix public enregistre son prix d'achat
create or replace function public.log_price_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  imp uuid := nullif(current_setting('climdevis.import_id', true), '')::uuid;
  new_price bigint;
  old_price bigint;
begin
  if tg_table_name = 'accessories' then
    new_price := coalesce(new.public_price_cents, new.purchase_price_cents);
    old_price := case when tg_op = 'UPDATE' then coalesce(old.public_price_cents, old.purchase_price_cents) end;
  else
    new_price := new.public_price_cents;
    old_price := case when tg_op = 'UPDATE' then old.public_price_cents end;
  end if;
  if tg_op = 'UPDATE' and new_price is not distinct from old_price and new.discount_rate is not distinct from old.discount_rate then
    return new;
  end if;
  insert into price_history (company_id, product_id, accessory_id, old_public_price_cents, new_public_price_cents, old_discount_rate, new_discount_rate, import_id)
  values (
    new.company_id,
    case when tg_table_name = 'products' then new.id end,
    case when tg_table_name = 'accessories' then new.id end,
    old_price,
    new_price,
    case when tg_op = 'UPDATE' then old.discount_rate end,
    new.discount_rate,
    imp
  );
  return new;
end $$;

-- Fiche d'intervention fluides : la réglementation l'impose à chaque ouverture du circuit
alter table companies alter column fluid_form_policy set default 'always';
update companies set fluid_form_policy = 'always' where fluid_form_policy = 'complement';

-- Retouches du devis
alter table quote_lines add column origin text not null default 'wizard' check (origin in ('wizard', 'manual'));
alter table quote_lines add column wizard_key text; -- clé de la ligne générée par l'assistant
alter table quote_lines alter column vat_rate set default 0.1;

-- Remise commerciale globale (montant HT en centimes, ou pourcentage décimal)
alter table quotes add column discount_kind text check (discount_kind is null or discount_kind in ('amount', 'percent'));
alter table quotes add column discount_value numeric(12,4) check (discount_value is null or discount_value >= 0);
alter table quotes add constraint quotes_discount_pair check ((discount_kind is null) = (discount_value is null));
alter table quotes add column discount_cents bigint not null default 0;

-- -----------------------------------------------------------------------------
-- Import de tarif : diamètres de liaison, longueur pré-chargée, charge au mètre
-- -----------------------------------------------------------------------------
create or replace function public.apply_catalog_import(
  p_target text,
  p_supplier_name text,
  p_mapping jsonb,
  p_filename text,
  p_brands jsonb,
  p_creates jsonb,
  p_updates jsonb
) returns uuid language plpgsql security invoker set search_path = public as $$
declare
  cid uuid := current_company_id();
  sid uuid;
  imp uuid;
  r jsonb;
begin
  if cid is null then raise exception 'Non authentifié'; end if;
  if p_target not in ('materiel', 'accessoires') then raise exception 'Cible d''import invalide'; end if;

  insert into suppliers (company_id, name) values (cid, trim(p_supplier_name))
  on conflict (company_id, name) do nothing;
  select id into sid from suppliers where company_id = cid and name = trim(p_supplier_name);
  update suppliers set column_mapping = column_mapping || jsonb_build_object(p_target, p_mapping) where id = sid;

  insert into catalog_imports (company_id, supplier_id, target, filename, created_count, updated_count)
  values (cid, sid, p_target, p_filename, jsonb_array_length(p_creates), jsonb_array_length(p_updates))
  returning id into imp;
  perform set_config('climdevis.import_id', imp::text, true);

  if p_target = 'materiel' then
    insert into brands (company_id, name, discount_rate)
    select cid, b->>'name', coalesce((b->>'discount_rate')::numeric, 0)
    from jsonb_array_elements(p_brands) b
    on conflict (company_id, name) do nothing;

    insert into products (company_id, brand_id, supplier_id, range_name, reference, type, cooling_kw, heating_kw, max_outlets, max_indoor_ratio,
                          link_diameters, precharged_length_m, extra_charge_g_per_m, public_price_cents, discount_rate)
    select cid, br.id, sid, r2->>'range_name', r2->>'reference', (r2->>'type')::product_type,
           (r2->>'cooling_kw')::numeric, (r2->>'heating_kw')::numeric, (r2->>'max_outlets')::smallint,
           (r2->>'max_indoor_ratio')::numeric, r2->>'link_diameters', (r2->>'precharged_length_m')::numeric,
           (r2->>'extra_charge_g_per_m')::smallint, (r2->>'public_price_cents')::bigint, (r2->>'discount_rate')::numeric
    from jsonb_array_elements(p_creates) r2
    join brands br on br.company_id = cid and br.name = r2->>'brand';

    for r in select * from jsonb_array_elements(p_updates) loop
      update products set
        supplier_id          = sid,
        public_price_cents   = (r->>'public_price_cents')::bigint,
        discount_rate        = case when r ? 'discount_rate' then (r->>'discount_rate')::numeric else discount_rate end,
        range_name           = coalesce(r->>'range_name', range_name),
        cooling_kw           = coalesce((r->>'cooling_kw')::numeric, cooling_kw),
        heating_kw           = coalesce((r->>'heating_kw')::numeric, heating_kw),
        max_outlets          = coalesce((r->>'max_outlets')::smallint, max_outlets),
        link_diameters       = coalesce(r->>'link_diameters', link_diameters),
        precharged_length_m  = coalesce((r->>'precharged_length_m')::numeric, precharged_length_m),
        extra_charge_g_per_m = coalesce((r->>'extra_charge_g_per_m')::smallint, extra_charge_g_per_m),
        active               = true
      where id = (r->>'id')::uuid and company_id = cid;
    end loop;
  else
    insert into accessories (company_id, supplier_id, reference, category, name, diameter, unit, public_price_cents, discount_rate)
    select cid, sid, r2->>'reference', r2->>'category', r2->>'name', r2->>'diameter', coalesce(r2->>'unit', 'u'),
           (r2->>'public_price_cents')::bigint, coalesce((r2->>'discount_rate')::numeric, 0)
    from jsonb_array_elements(p_creates) r2;

    for r in select * from jsonb_array_elements(p_updates) loop
      update accessories set
        supplier_id        = sid,
        public_price_cents = (r->>'public_price_cents')::bigint,
        discount_rate      = case when r ? 'discount_rate' then (r->>'discount_rate')::numeric else discount_rate end,
        name               = coalesce(r->>'name', name),
        active             = true
      where id = (r->>'id')::uuid and company_id = cid;
    end loop;
  end if;

  return imp;
end $$;

-- >>>>> 20261114000006_quote_document.sql
-- =============================================================================
-- Étape 6 : document du devis — médiateur, acompte, échéancier, rétractation.
-- =============================================================================

-- Médiateur de la consommation (obligatoire pour un client particulier)
alter table companies add column mediator_name text;
alter table companies add column mediator_address text;
alter table companies add column mediator_website text;

-- Acompte par défaut (30 %)
alter table companies add column deposit_rate numeric(4,3) not null default 0.300 check (deposit_rate >= 0 and deposit_rate < 1);

-- Réglages du document, par devis
alter table quotes add column signed_off_premises boolean not null default true;   -- signé chez le client
alter table quotes add column early_start boolean not null default false;          -- démarrage avant la fin des 14 jours
alter table quotes add column urgent_repair boolean not null default false;        -- dépannage urgent demandé par le client
alter table quotes add column deposit_rate numeric(4,3) check (deposit_rate is null or (deposit_rate >= 0 and deposit_rate < 1));
-- échéancier : [{ "label": "À la livraison du matériel", "rate": 0.4 }, …] (la somme fait 100 %)
alter table quotes add column payment_schedule jsonb;

-- >>>>> 20261114000007_dashboard.sql
-- =============================================================================
-- Étape 7 : tableau de bord — relances, duplication.
-- =============================================================================

-- Délai avant relance d'un devis envoyé sans réponse (7 jours par défaut)
alter table companies add column follow_up_days smallint not null default 7 check (follow_up_days between 1 and 90);

alter table quotes add column last_follow_up_at timestamptz;
alter table quotes add column follow_up_count smallint not null default 0;

-- Le devis d'origine d'une copie doit appartenir à la même entreprise
create or replace function public.check_duplicated_from()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.duplicated_from is not null and not exists (select 1 from quotes where id = new.duplicated_from and company_id = new.company_id) then
    raise exception 'Devis d''origine inconnu pour cette entreprise';
  end if;
  return new;
end $$;
create trigger quotes_duplicated_from before insert or update of duplicated_from on quotes
  for each row execute function public.check_duplicated_from();

create index if not exists quotes_company_decided on quotes (company_id, decided_at) where status = 'accepte';

-- >>>>> 20261114000008_team_and_billing.sql
-- =============================================================================
-- Étape 8 : équipe (rôles, invitations), abonnement (formules, lancement),
-- lecture seule à la fin de l'essai — garanties EN BASE, pas seulement à l'écran.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Rôles
-- ---------------------------------------------------------------------------
alter table profiles add column access_role text not null default 'admin' check (access_role in ('admin', 'technicien'));
alter table profiles add column email text;
update profiles p set email = u.email from auth.users u where u.id = p.id and p.email is null;

alter table companies add column technicians_see_margins boolean not null default false;

-- Un utilisateur ne modifie que son nom : ni son entreprise, ni son rôle.
drop policy if exists profiles_update_self on profiles;
create policy profiles_update_self on profiles for update using (id = auth.uid()) with check (id = auth.uid());
revoke update on profiles from authenticated;
grant update (full_name) on profiles to authenticated;

create or replace function public.current_is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select access_role = 'admin' from profiles where id = auth.uid()), false)
$$;

-- ---------------------------------------------------------------------------
-- Abonnement
-- ---------------------------------------------------------------------------
alter table subscriptions add column plan text check (plan is null or plan in ('solo', 'equipe', 'entreprise'));
alter table subscriptions add column billing_interval text check (billing_interval is null or billing_interval in ('month', 'year'));
alter table subscriptions add column launch_offer boolean not null default false;
alter table subscriptions add column cancel_at_period_end boolean not null default false;

-- Écriture permise : essai en cours, abonné, ou paiement en échec (délai de grâce).
create or replace function public.company_can_write()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from subscriptions s
    where s.company_id = current_company_id()
      and (s.status in ('active', 'past_due') or (s.status = 'trialing' and s.trial_ends_at > now()))
  )
$$;

-- Offre de lancement : 50 places, jamais rendues (un abonné qui part ne libère pas sa place).
create or replace function public.launch_seats_left()
returns integer language sql stable security definer set search_path = public as $$
  select greatest(0, 50 - (select count(*) from subscriptions where launch_offer)::int)
$$;
grant execute on function public.launch_seats_left() to anon, authenticated;

-- Appelée par le webhook Stripe (clé service) : réserve une place, en série (verrou).
create or replace function public.claim_launch_seat(p_company_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare taken int;
begin
  perform pg_advisory_xact_lock(4242);
  if exists (select 1 from subscriptions where company_id = p_company_id and launch_offer) then return true; end if;
  select count(*) into taken from subscriptions where launch_offer;
  if taken >= 50 then return false; end if;
  update subscriptions set launch_offer = true where company_id = p_company_id;
  return true;
end $$;
revoke all on function public.claim_launch_seat(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Invitations
-- ---------------------------------------------------------------------------
create table invitations (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references companies(id) on delete cascade,
  email        text not null,
  access_role  text not null default 'technicien' check (access_role in ('admin', 'technicien')),
  token        text not null unique default encode(gen_random_bytes(24), 'hex'),
  invited_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default (now() + interval '14 days'),
  accepted_at  timestamptz
);
create unique index invitations_pending_email on invitations (company_id, lower(email)) where accepted_at is null;
alter table invitations enable row level security;
create policy invitations_admin on invitations for all
  using (company_id = current_company_id() and current_is_admin())
  with check (company_id = current_company_id() and current_is_admin());

-- Aperçu d'une invitation (page publique d'acceptation) : entreprise et e-mail invités seulement.
create or replace function public.invitation_preview(p_token text)
returns table (company_name text, email text, access_role text, expired boolean, accepted boolean)
language sql stable security definer set search_path = public as $$
  select c.legal_name, i.email, i.access_role, i.expires_at < now(), i.accepted_at is not null
  from invitations i join companies c on c.id = i.company_id where i.token = p_token
$$;
grant execute on function public.invitation_preview(text) to anon, authenticated;

create or replace function public.accept_invitation(p_token text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  inv invitations;
  user_email text;
begin
  if auth.uid() is null then raise exception 'Non authentifié'; end if;
  select * into inv from invitations where token = p_token for update;
  if inv.id is null then raise exception 'Invitation introuvable'; end if;
  if inv.accepted_at is not null then raise exception 'Invitation déjà utilisée'; end if;
  if inv.expires_at < now() then raise exception 'Invitation expirée'; end if;
  select email into user_email from auth.users where id = auth.uid();
  if lower(user_email) <> lower(inv.email) then raise exception 'Cette invitation est destinée à %', inv.email; end if;
  if exists (select 1 from profiles where id = auth.uid()) then raise exception 'Ce compte est déjà rattaché à une entreprise'; end if;
  insert into profiles (id, company_id, role, access_role, email) values (auth.uid(), inv.company_id, 'member', inv.access_role, user_email);
  update invitations set accepted_at = now() where id = inv.id;
  return inv.company_id;
end $$;
revoke all on function public.accept_invitation(text) from public, anon;
grant execute on function public.accept_invitation(text) to authenticated;

-- Gestion des membres par un administrateur (jamais le titulaire du compte)
create or replace function public.set_member_role(p_user_id uuid, p_role text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not current_is_admin() then raise exception 'Réservé aux administrateurs'; end if;
  if p_role not in ('admin', 'technicien') then raise exception 'Rôle invalide'; end if;
  update profiles set access_role = p_role
  where id = p_user_id and company_id = current_company_id() and role <> 'owner';
  if not found then raise exception 'Membre introuvable (le titulaire du compte reste administrateur)'; end if;
end $$;

create or replace function public.remove_member(p_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not current_is_admin() then raise exception 'Réservé aux administrateurs'; end if;
  delete from profiles where id = p_user_id and company_id = current_company_id() and role <> 'owner' and id <> auth.uid();
  if not found then raise exception 'Membre introuvable (impossible de retirer le titulaire ou soi-même)'; end if;
end $$;
revoke all on function public.set_member_role(uuid, text) from public, anon;
revoke all on function public.remove_member(uuid) from public, anon;
grant execute on function public.set_member_role(uuid, text) to authenticated;
grant execute on function public.remove_member(uuid) to authenticated;

-- Le titulaire est administrateur, avec son e-mail
create or replace function public.create_company_for_current_user(p_legal_name text, p_full_name text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  cid uuid;
  user_email text;
begin
  if auth.uid() is null then raise exception 'Non authentifié'; end if;
  select company_id into cid from profiles where id = auth.uid();
  if cid is not null then return cid; end if;
  select email into user_email from auth.users where id = auth.uid();
  insert into companies (legal_name, email) values (coalesce(nullif(trim(p_legal_name), ''), 'Mon entreprise'), user_email) returning id into cid;
  insert into profiles (id, company_id, full_name, role, access_role, email) values (auth.uid(), cid, p_full_name, 'owner', 'admin', user_email);
  insert into subscriptions (company_id) values (cid);
  insert into settings_coefficients (company_id, sizing, labor_days) values (cid, default_sizing_coefficients(), default_labor_days());
  perform seed_example_catalog(cid);
  perform seed_example_accessories_v2(cid);
  return cid;
end $$;

-- ---------------------------------------------------------------------------
-- RLS : administrateurs pour les paramètres et le catalogue, lecture seule hors abonnement
-- ---------------------------------------------------------------------------
drop policy companies_update on companies;
create policy companies_update on companies for update
  using (id = current_company_id() and current_is_admin())
  with check (id = current_company_id() and current_is_admin());

-- Catalogue et réglages : lecture pour tous les membres, écriture pour les administrateurs
do $$
declare t text;
begin
  foreach t in array array['settings_coefficients', 'brands', 'products', 'accessories', 'suppliers'] loop
    execute format('drop policy %1$s_all on %1$s', t);
    execute format('create policy %1$s_select on %1$s for select using (company_id = current_company_id())', t);
    execute format('create policy %1$s_write on %1$s for all using (company_id = current_company_id() and current_is_admin()) with check (company_id = current_company_id() and current_is_admin())', t);
  end loop;
end $$;
drop policy catalog_imports_insert on catalog_imports;
create policy catalog_imports_insert on catalog_imports for insert with check (company_id = current_company_id() and current_is_admin());

-- Devis, clients, chantiers : tous les membres, mais pas d'écriture en lecture seule
do $$
declare t text;
begin
  foreach t in array array['clients', 'projects', 'rooms', 'quotes', 'quote_lines'] loop
    execute format('drop policy %1$s_all on %1$s', t);
    execute format('create policy %1$s_select on %1$s for select using (company_id = current_company_id())', t);
    execute format('create policy %1$s_insert on %1$s for insert with check (company_id = current_company_id() and company_can_write())', t);
    execute format('create policy %1$s_update on %1$s for update using (company_id = current_company_id() and company_can_write()) with check (company_id = current_company_id() and company_can_write())', t);
    execute format('create policy %1$s_delete on %1$s for delete using (company_id = current_company_id() and company_can_write())', t);
  end loop;
end $$;

-- Logos et tampons : lisibles par tous les membres (PDF), modifiables par les administrateurs
drop policy company_assets_rw on storage.objects;
create policy company_assets_read on storage.objects for select
  using (bucket_id = 'company-assets' and (storage.foldername(name))[1] = current_company_id()::text);
create policy company_assets_write on storage.objects for insert
  with check (bucket_id = 'company-assets' and (storage.foldername(name))[1] = current_company_id()::text and current_is_admin());
create policy company_assets_update on storage.objects for update
  using (bucket_id = 'company-assets' and (storage.foldername(name))[1] = current_company_id()::text and current_is_admin());
create policy company_assets_delete on storage.objects for delete
  using (bucket_id = 'company-assets' and (storage.foldername(name))[1] = current_company_id()::text and current_is_admin());

-- >>>>> 20261114000009_margin_isolation.sql
-- =============================================================================
-- Cloisonnement des marges EN BASE : un technicien sans l'option « voir les
-- marges » ne peut lire AUCUN prix d'achat, remise ou marge, même via l'API.
--
-- Tables concernées (lecture réservée aux membres autorisés) :
--   brands (remise), products (remise), accessories (remise, prix d'achat),
--   price_history, suppliers, catalog_imports, quote_lines (prix d'achat),
--   quote_financials (marge nette du devis, sortie de la table quotes).
-- Les calculs qui ont besoin des coûts sont faits côté serveur (clé service,
-- filtrée par entreprise) et seuls des résultats nettoyés partent au navigateur.
-- =============================================================================

create or replace function public.current_can_see_margins()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select p.access_role = 'admin' or c.technicians_see_margins
    from profiles p join companies c on c.id = p.company_id
    where p.id = auth.uid()
  ), false)
$$;

-- Marge nette des devis : table dédiée (la table quotes reste lisible par tous les membres)
create table quote_financials (
  quote_id         uuid primary key references quotes(id) on delete cascade,
  company_id       uuid not null references companies(id) on delete cascade,
  net_margin_cents bigint not null default 0,
  updated_at       timestamptz not null default now()
);
insert into quote_financials (quote_id, company_id, net_margin_cents)
select id, company_id, net_margin_cents from quotes;
alter table quotes drop column net_margin_cents;

alter table quote_financials enable row level security;
create policy quote_financials_select on quote_financials for select
  using (company_id = current_company_id() and current_can_see_margins());
create policy quote_financials_write on quote_financials for all
  using (company_id = current_company_id() and current_can_see_margins() and company_can_write())
  with check (company_id = current_company_id() and current_can_see_margins() and company_can_write());

-- Lecture des tables de coûts : membres autorisés seulement
do $$
declare t text;
begin
  foreach t in array array['brands', 'products', 'accessories', 'suppliers'] loop
    execute format('drop policy %1$s_select on %1$s', t);
    execute format('create policy %1$s_select on %1$s for select using (company_id = current_company_id() and current_can_see_margins())', t);
  end loop;
end $$;

drop policy price_history_select on price_history;
create policy price_history_select on price_history for select using (company_id = current_company_id() and current_can_see_margins());
drop policy catalog_imports_select on catalog_imports;
create policy catalog_imports_select on catalog_imports for select using (company_id = current_company_id() and current_can_see_margins());

-- Lignes de devis : lecture, modification et suppression réservées aux membres autorisés.
-- (Pour un technicien sans l'option, le serveur lit et écrit les lignes pour lui,
-- après contrôle de l'entreprise et des droits, et ne lui renvoie que les prix de vente.)
drop policy quote_lines_select on quote_lines;
drop policy quote_lines_insert on quote_lines;
drop policy quote_lines_update on quote_lines;
drop policy quote_lines_delete on quote_lines;
create policy quote_lines_select on quote_lines for select
  using (company_id = current_company_id() and current_can_see_margins());
create policy quote_lines_insert on quote_lines for insert
  with check (company_id = current_company_id() and current_can_see_margins() and company_can_write());
create policy quote_lines_update on quote_lines for update
  using (company_id = current_company_id() and current_can_see_margins() and company_can_write())
  with check (company_id = current_company_id() and current_can_see_margins() and company_can_write());
create policy quote_lines_delete on quote_lines for delete
  using (company_id = current_company_id() and current_can_see_margins() and company_can_write());

-- Vues sans coûts, utilisables par tous les membres (prix de vente uniquement).
-- Vues « definer » : elles filtrent elles-mêmes sur l'entreprise de l'utilisateur.
create view quote_lines_public with (security_barrier) as
  select id, company_id, quote_id, position, kind, origin, wizard_key, product_id, accessory_id, room_id,
         designation, quantity, unit, unit_sale_cents, vat_rate
  from quote_lines where company_id = current_company_id();

create view catalog_products_public with (security_barrier) as
  select p.id, p.company_id, p.brand_id, b.name as brand_name, p.range_name, p.reference, p.type,
         p.cooling_kw, p.heating_kw, p.max_outlets, p.max_indoor_ratio, p.link_diameters,
         p.precharged_length_m, p.extra_charge_g_per_m, p.is_example, p.active,
         round(p.public_price_cents * b.sale_coefficient)::bigint as sale_price_cents
  from products p join brands b on b.id = p.brand_id
  where p.company_id = current_company_id();

create view catalog_accessories_public with (security_barrier) as
  select a.id, a.company_id, a.reference, a.category, a.name, a.diameter, a.unit, a.auto_role, a.is_example, a.active,
         case
           when a.public_price_cents is null then round(coalesce(a.purchase_price_cents, 0) * c.accessory_purchase_coefficient)::bigint
           else greatest(round(a.public_price_cents * c.accessory_sale_coefficient),
                         round(round(a.public_price_cents * (1 - a.discount_rate)) * c.accessory_purchase_coefficient))::bigint
         end as sale_price_cents
  from accessories a join companies c on c.id = a.company_id
  where a.company_id = current_company_id();

revoke all on quote_lines_public, catalog_products_public, catalog_accessories_public from anon;
grant select on quote_lines_public, catalog_products_public, catalog_accessories_public to authenticated;

-- ATTENTION pour les migrations futures : toute nouvelle colonne de `companies` doit être
-- ajoutée explicitement par « grant select (colonne) on companies to authenticated ».
--
-- Le coefficient plancher sur achat des accessoires permettrait de retrouver un prix
-- d'achat (vente ÷ coefficient) : colonne illisible via l'API, servie seulement aux
-- membres autorisés par une fonction.
do $$
declare cols text;
begin
  select string_agg(quote_ident(column_name), ', ') into cols
  from information_schema.columns
  where table_schema = 'public' and table_name = 'companies' and column_name <> 'accessory_purchase_coefficient';
  execute 'revoke select on public.companies from authenticated, anon';
  execute format('grant select (%s) on public.companies to authenticated', cols);
end $$;

create or replace function public.company_accessory_purchase_coefficient()
returns numeric language sql stable security definer set search_path = public as $$
  select case when current_can_see_margins() then accessory_purchase_coefficient end
  from companies where id = current_company_id()
$$;
grant execute on function public.company_accessory_purchase_coefficient() to authenticated;

-- >>>>> 20261115000010_multi_suppliers.sql
-- =============================================================================
-- Bloc B : multi-fournisseurs.
--
--  - fiche fournisseur (agence, contact, conditions de livraison, port / franco) ;
--  - tarif de chaque fournisseur pour chaque article (« offres ») : code
--    fournisseur, EAN, prix public, prix net, remise, famille de remise ;
--  - remises par fournisseur à 3 niveaux : marque → famille → référence ;
--  - fournisseur de référence par marque (prix public de référence) ;
--  - fournisseur retenu par ligne de devis, frais de port, bons de commande ;
--  - quotas d'analyse IA (plans / pages de tarif PDF) et mémoire des PDF analysés.
--
-- Tout ce qui révèle un fournisseur ou un prix net est réservé aux membres
-- autorisés à voir les marges (current_can_see_margins()), comme en migration 9.
-- Les calculs (prix nets, choix du fournisseur) sont faits par
-- src/lib/suppliers/pricing.ts ; la base stocke et cloisonne.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Fournisseurs
-- -----------------------------------------------------------------------------
alter table suppliers add column agency text;
alter table suppliers add column contact_name text;
alter table suppliers add column phone text;
alter table suppliers add column email text;
alter table suppliers add column delivery_terms text;
alter table suppliers add column shipping_fee_cents bigint not null default 0 check (shipping_fee_cents >= 0);
alter table suppliers add column franco_cents bigint check (franco_cents is null or franco_cents > 0);
-- barème optionnel : [{ "fromCents": 20000, "feeCents": 2500 }, …]
alter table suppliers add column shipping_tiers jsonb not null default '[]'::jsonb check (jsonb_typeof(shipping_tiers) = 'array');
alter table suppliers add column last_price_update_at timestamptz;
alter table suppliers add column active boolean not null default true;

-- Fournisseur de référence de la marque : donne le prix public de référence.
alter table brands add column reference_supplier_id uuid references suppliers(id) on delete set null;

-- Accessoires : prix d'achat net le plus élevé chez les fournisseurs (plancher du prix de vente,
-- pour qu'aucun fournisseur ne fasse vendre sous « achat × coefficient »).
alter table accessories add column floor_purchase_cents bigint check (floor_purchase_cents is null or floor_purchase_cents >= 0);

-- -----------------------------------------------------------------------------
-- Tarifs par fournisseur (« offres »)
-- -----------------------------------------------------------------------------
create table supplier_offers (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references companies(id) on delete cascade,
  supplier_id        uuid not null references suppliers(id) on delete cascade,
  product_id         uuid references products(id) on delete cascade,
  accessory_id       uuid references accessories(id) on delete cascade,
  supplier_ref       text,                 -- code article du fournisseur
  manufacturer_ref   text,                 -- référence fabricant telle qu'écrite dans le tarif
  ean                text,
  designation        text,
  public_price_cents bigint check (public_price_cents is null or public_price_cents >= 0),
  net_price_cents    bigint check (net_price_cents is null or net_price_cents >= 0),
  discount_rate      numeric(5,4) check (discount_rate is null or (discount_rate >= 0 and discount_rate < 1)),  -- niveau « référence »
  discount_family    text,                 -- famille de remise (ou gamme)
  -- certain : EAN ou référence identique ; probable : à confirmer (ignoré dans les prix) ; manuel : confirmé à la main
  match_status       text not null default 'certain' check (match_status in ('certain', 'probable', 'manuel')),
  match_reason       text,
  updated_at         timestamptz not null default now(),
  check ((product_id is null) <> (accessory_id is null)),
  check (public_price_cents is not null or net_price_cents is not null),
  unique (supplier_id, product_id),
  unique (supplier_id, accessory_id)
);
create index on supplier_offers (product_id);
create index on supplier_offers (accessory_id);
create index on supplier_offers (company_id, match_status);

-- Remises par fournisseur : marque (brand_id) OU famille (family_key normalisée)
create table supplier_discounts (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  supplier_id uuid not null references suppliers(id) on delete cascade,
  brand_id    uuid references brands(id) on delete cascade,
  family      text,
  family_key  text,
  rate        numeric(5,4) not null check (rate >= 0 and rate < 1),
  updated_at  timestamptz not null default now(),
  check ((brand_id is null) <> (family_key is null)),
  check ((family is null) = (family_key is null)),
  unique (supplier_id, brand_id),
  unique (supplier_id, family_key)
);

-- Historique des prix : aussi par fournisseur, prix net compris
alter table price_history add column supplier_id uuid references suppliers(id) on delete set null;
alter table price_history add column old_net_price_cents bigint;
alter table price_history add column new_net_price_cents bigint;
alter table price_history alter column new_public_price_cents drop not null;

create or replace function public.log_offer_price_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  imp uuid := nullif(current_setting('climdevis.import_id', true), '')::uuid;
begin
  if tg_op = 'UPDATE'
     and new.public_price_cents is not distinct from old.public_price_cents
     and new.net_price_cents is not distinct from old.net_price_cents
     and new.discount_rate is not distinct from old.discount_rate then
    return new;
  end if;
  insert into price_history (company_id, product_id, accessory_id, supplier_id,
                             old_public_price_cents, new_public_price_cents, old_net_price_cents, new_net_price_cents,
                             old_discount_rate, new_discount_rate, import_id)
  values (new.company_id, new.product_id, new.accessory_id, new.supplier_id,
          case when tg_op = 'UPDATE' then old.public_price_cents end, new.public_price_cents,
          case when tg_op = 'UPDATE' then old.net_price_cents end, new.net_price_cents,
          case when tg_op = 'UPDATE' then old.discount_rate end, new.discount_rate, imp);
  -- Alerte « tarif ancien » : date de la dernière mise à jour de prix du fournisseur
  update suppliers set last_price_update_at = now() where id = new.supplier_id;
  return new;
end $$;
create trigger supplier_offers_price_history after insert or update on supplier_offers
  for each row execute function public.log_offer_price_change();

create or replace function public.touch_supplier_price_date()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update suppliers set last_price_update_at = now() where id = coalesce(new.supplier_id, old.supplier_id);
  return coalesce(new, old);
end $$;
create trigger supplier_discounts_touch after insert or update or delete on supplier_discounts
  for each row execute function public.touch_supplier_price_date();

-- Le prix public saisi sur l'article lui-même n'est plus la source des prix
-- (c'est le prix de référence, recalculé) : on ne l'historise plus en double.
drop trigger products_price_history on products;
drop trigger accessories_price_history on accessories;

-- -----------------------------------------------------------------------------
-- Cohérence : tout objet référencé appartient à la même entreprise
-- -----------------------------------------------------------------------------
create or replace function public.check_company_refs()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  j   jsonb := to_jsonb(new);
  cid uuid := (j->>'company_id')::uuid;
  col text;
begin
  foreach col in array array['supplier_id', 'reference_supplier_id', 'forced_supplier_id'] loop
    if j->>col is not null and not exists (select 1 from suppliers where id = (j->>col)::uuid and company_id = cid) then
      raise exception 'Fournisseur inconnu pour cette entreprise';
    end if;
  end loop;
  if j->>'product_id' is not null and not exists (select 1 from products where id = (j->>'product_id')::uuid and company_id = cid) then
    raise exception 'Article inconnu pour cette entreprise';
  end if;
  if j->>'accessory_id' is not null and not exists (select 1 from accessories where id = (j->>'accessory_id')::uuid and company_id = cid) then
    raise exception 'Accessoire inconnu pour cette entreprise';
  end if;
  if j->>'brand_id' is not null and not exists (select 1 from brands where id = (j->>'brand_id')::uuid and company_id = cid) then
    raise exception 'Marque inconnue pour cette entreprise';
  end if;
  if j->>'quote_id' is not null and not exists (select 1 from quotes where id = (j->>'quote_id')::uuid and company_id = cid) then
    raise exception 'Devis inconnu pour cette entreprise';
  end if;
  return new;
end $$;

create trigger supplier_offers_company before insert or update on supplier_offers for each row execute function public.check_company_refs();
create trigger supplier_discounts_company before insert or update on supplier_discounts for each row execute function public.check_company_refs();
create trigger brands_reference_supplier_company before insert or update of reference_supplier_id on brands for each row execute function public.check_company_refs();

-- -----------------------------------------------------------------------------
-- Devis : fournisseur retenu par ligne, frais de port, choix « tout chez X »
-- -----------------------------------------------------------------------------
alter table quote_lines add column supplier_id uuid references suppliers(id) on delete set null;
alter table quote_lines add column supplier_forced boolean not null default false;
create trigger quote_lines_supplier_company before insert or update of supplier_id on quote_lines for each row execute function public.check_company_refs();

-- Données d'achat du devis : dans quote_financials (lecture réservée, migration 9)
alter table quote_financials add column shipping_cents bigint not null default 0 check (shipping_cents >= 0);
alter table quote_financials add column forced_supplier_id uuid references suppliers(id) on delete set null;
alter table quote_financials add column shipping_rebill boolean not null default false;
-- Comparatif des scénarios (montants d'achat) : { "optimal": …, "perLine": …, "allAt": [...] }
alter table quote_financials add column supplier_comparison jsonb;
create trigger quote_financials_supplier_company before insert or update of forced_supplier_id on quote_financials for each row execute function public.check_company_refs();

-- -----------------------------------------------------------------------------
-- Bons de commande fournisseur (devis accepté)
-- -----------------------------------------------------------------------------
create table purchase_orders (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  quote_id      uuid not null references quotes(id) on delete cascade,
  supplier_id   uuid not null references suppliers(id) on delete cascade,
  number        text not null,
  delivery      text not null default 'depot' check (delivery in ('depot', 'chantier')),
  desired_date  date,
  content       jsonb not null,   -- instantané du bon (src/lib/suppliers/orders.ts)
  total_cents   bigint not null default 0,
  generated_at  timestamptz not null default now(),
  generated_by  uuid references auth.users(id) on delete set null,
  unique (quote_id, supplier_id)
);
create trigger purchase_orders_company before insert or update on purchase_orders for each row execute function public.check_company_refs();

-- -----------------------------------------------------------------------------
-- Imports de tarifs : empreinte du fichier, mémoire des PDF déjà analysés par l'IA
-- -----------------------------------------------------------------------------
alter table catalog_imports add column file_hash text;
alter table catalog_imports add column source text not null default 'tableur' check (source in ('tableur', 'pdf'));

create table pdf_tariff_extractions (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references companies(id) on delete cascade,
  supplier_id  uuid references suppliers(id) on delete set null,
  file_hash    text not null,
  pages        text not null,       -- pages analysées, ex. « 1-4,7 »
  page_count   integer not null check (page_count > 0),
  rows         jsonb not null,      -- lignes extraites (avant validation)
  created_at   timestamptz not null default now(),
  unique (company_id, file_hash, pages)
);
create trigger pdf_tariff_extractions_company before insert or update on pdf_tariff_extractions for each row execute function public.check_company_refs();

-- Consommation IA du mois, par entreprise et par usage (écriture : serveur uniquement)
create table ai_usage (
  company_id uuid not null references companies(id) on delete cascade,
  month      date not null,
  kind       text not null check (kind in ('plan', 'tarif_pdf')),
  units      integer not null default 0 check (units >= 0),
  primary key (company_id, month, kind)
);

-- Quotas mensuels par formule (essai = Solo) :
--   analyses de plans : Solo 30 / Équipe 100 / Entreprise 300
--   pages de tarif PDF : Solo 300 / Équipe 1 000 / Entreprise 3 000
create or replace function public.ai_quota_limit(p_company uuid, p_kind text)
returns integer language sql stable security definer set search_path = public as $$
  select case p_kind
    when 'plan' then case s.plan when 'equipe' then 100 when 'entreprise' then 300 else 30 end
    when 'tarif_pdf' then case s.plan when 'equipe' then 1000 when 'entreprise' then 3000 else 300 end
  end
  from (select (select plan from subscriptions where company_id = p_company) as plan) s
$$;

-- Réserve p_units unités ; renvoie le reste du mois, ou lève une erreur si le quota est dépassé.
create or replace function public.consume_ai_quota(p_company uuid, p_kind text, p_units integer)
returns integer language plpgsql security definer set search_path = public as $$
declare
  m     date := date_trunc('month', now())::date;
  lim   integer := ai_quota_limit(p_company, p_kind);
  used  integer;
begin
  if p_units <= 0 then raise exception 'Quantité invalide'; end if;
  insert into ai_usage (company_id, month, kind, units) values (p_company, m, p_kind, 0)
  on conflict do nothing;
  select units into used from ai_usage where company_id = p_company and month = m and kind = p_kind for update;
  if used + p_units > lim then
    raise exception 'QUOTA_DEPASSE' using detail = format('%s/%s', used, lim);
  end if;
  update ai_usage set units = units + p_units where company_id = p_company and month = m and kind = p_kind;
  return lim - used - p_units;
end $$;

-- Rend des unités si l'analyse a échoué.
create or replace function public.refund_ai_quota(p_company uuid, p_kind text, p_units integer)
returns void language sql security definer set search_path = public as $$
  update ai_usage set units = greatest(0, units - greatest(p_units, 0))
  where company_id = p_company and month = date_trunc('month', now())::date and kind = p_kind
$$;

-- État du quota pour l'utilisateur connecté (affichage).
create or replace function public.ai_quota_status(p_kind text)
returns table (used integer, quota integer) language sql stable security definer set search_path = public as $$
  select coalesce((select units from ai_usage where company_id = current_company_id() and month = date_trunc('month', now())::date and kind = p_kind), 0),
         ai_quota_limit(current_company_id(), p_kind)
  where current_company_id() is not null
$$;

revoke all on function public.ai_quota_limit(uuid, text) from public, anon, authenticated;
revoke all on function public.consume_ai_quota(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.refund_ai_quota(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.consume_ai_quota(uuid, text, integer) to service_role;
grant execute on function public.refund_ai_quota(uuid, text, integer) to service_role;
revoke all on function public.ai_quota_status(text) from public, anon;
grant execute on function public.ai_quota_status(text) to authenticated;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table supplier_offers        enable row level security;
alter table supplier_discounts     enable row level security;
alter table purchase_orders        enable row level security;
alter table pdf_tariff_extractions enable row level security;
alter table ai_usage               enable row level security;

do $$
declare t text;
begin
  foreach t in array array['supplier_offers', 'supplier_discounts', 'pdf_tariff_extractions'] loop
    execute format('create policy %1$s_select on %1$s for select using (company_id = current_company_id() and current_can_see_margins())', t);
    execute format('create policy %1$s_write on %1$s for all using (company_id = current_company_id() and current_is_admin()) with check (company_id = current_company_id() and current_is_admin())', t);
  end loop;
end $$;

create policy purchase_orders_select on purchase_orders for select
  using (company_id = current_company_id() and current_can_see_margins());
create policy purchase_orders_write on purchase_orders for all
  using (company_id = current_company_id() and current_can_see_margins() and company_can_write())
  with check (company_id = current_company_id() and current_can_see_margins() and company_can_write());

create policy ai_usage_select on ai_usage for select using (company_id = current_company_id());

-- -----------------------------------------------------------------------------
-- Vue accessoires sans coûts : plancher sur le prix d'achat net le plus élevé
-- -----------------------------------------------------------------------------
create or replace view catalog_accessories_public with (security_barrier) as
  select a.id, a.company_id, a.reference, a.category, a.name, a.diameter, a.unit, a.auto_role, a.is_example, a.active,
         case
           when a.public_price_cents is null then round(coalesce(a.floor_purchase_cents, a.purchase_price_cents, 0) * c.accessory_purchase_coefficient)::bigint
           else greatest(round(a.public_price_cents * c.accessory_sale_coefficient),
                         round(coalesce(a.floor_purchase_cents, round(a.public_price_cents * (1 - a.discount_rate))) * c.accessory_purchase_coefficient))::bigint
         end as sale_price_cents
  from accessories a join companies c on c.id = a.company_id
  where a.company_id = current_company_id();

-- -----------------------------------------------------------------------------
-- Import d'un tarif fournisseur, en UNE transaction (plan calculé par
-- src/lib/catalog/import.ts, appliqué sous la RLS de l'appelant : administrateur).
--
-- p_brands  : [{ "name": "..." }]                                  marques à créer
-- p_creates : [{ article…, "offer": { offre… } }]                    nouveaux articles + leur offre
-- p_offers  : [{ "item_id": "...", "match_status": "certain", … }]   offres d'articles existants
-- p_updates : [{ "id": "...", champs techniques… }]                  (matériel seulement)
-- Une remise absente d'une offre (clé « discount_rate » absente) n'écrase pas la remise existante.
-- -----------------------------------------------------------------------------
create or replace function public.apply_supplier_import(
  p_supplier_id uuid,
  p_target text,
  p_mapping jsonb,
  p_filename text,
  p_file_hash text,
  p_source text,
  p_brands jsonb,
  p_creates jsonb,
  p_offers jsonb,
  p_updates jsonb
) returns uuid language plpgsql security invoker set search_path = public as $$
declare
  cid  uuid := current_company_id();
  imp  uuid;
  r    jsonb;
  o    jsonb;
  item uuid;
begin
  if cid is null then raise exception 'Non authentifié'; end if;
  if p_target not in ('materiel', 'accessoires') then raise exception 'Cible d''import invalide'; end if;
  if not exists (select 1 from suppliers where id = p_supplier_id and company_id = cid) then raise exception 'Fournisseur inconnu'; end if;

  update suppliers set column_mapping = column_mapping || jsonb_build_object(p_target, coalesce(p_mapping, '{}'::jsonb))
  where id = p_supplier_id;

  insert into catalog_imports (company_id, supplier_id, target, filename, file_hash, source, created_count, updated_count)
  values (cid, p_supplier_id, p_target, p_filename, p_file_hash, coalesce(p_source, 'tableur'), jsonb_array_length(p_creates), jsonb_array_length(p_offers))
  returning id into imp;
  perform set_config('climdevis.import_id', imp::text, true);

  if p_target = 'materiel' then
    insert into brands (company_id, name, discount_rate)
    select cid, b->>'name', 0 from jsonb_array_elements(p_brands) b
    on conflict (company_id, name) do nothing;
  end if;

  for r in select * from jsonb_array_elements(p_creates) loop
    o := r->'offer';
    if p_target = 'materiel' then
      insert into products (company_id, brand_id, supplier_id, range_name, reference, type, cooling_kw, heating_kw, max_outlets,
                            link_diameters, precharged_length_m, extra_charge_g_per_m, public_price_cents)
      select cid, br.id, p_supplier_id, r->>'range_name', r->>'reference', (r->>'type')::product_type,
             (r->>'cooling_kw')::numeric, (r->>'heating_kw')::numeric, (r->>'max_outlets')::smallint,
             r->>'link_diameters', (r->>'precharged_length_m')::numeric, (r->>'extra_charge_g_per_m')::integer,
             coalesce((o->>'public_price_cents')::bigint, (o->>'net_price_cents')::bigint)
      from brands br where br.company_id = cid and br.name = r->>'brand'
      returning id into item;
      if item is null then raise exception 'Marque introuvable : %', r->>'brand'; end if;
      insert into supplier_offers (company_id, supplier_id, product_id, supplier_ref, manufacturer_ref, ean, designation,
                                   public_price_cents, net_price_cents, discount_rate, discount_family, match_status, match_reason)
      values (cid, p_supplier_id, item, o->>'supplier_ref', o->>'manufacturer_ref', o->>'ean', o->>'designation',
              (o->>'public_price_cents')::bigint, (o->>'net_price_cents')::bigint, (o->>'discount_rate')::numeric, o->>'discount_family',
              'certain', 'Nouvel article');
    else
      insert into accessories (company_id, supplier_id, reference, category, name, diameter, unit, public_price_cents, purchase_price_cents, discount_rate)
      values (cid, p_supplier_id, r->>'reference', r->>'category', r->>'name', r->>'diameter', coalesce(r->>'unit', 'u'),
              (o->>'public_price_cents')::bigint, (o->>'net_price_cents')::bigint, 0)
      returning id into item;
      insert into supplier_offers (company_id, supplier_id, accessory_id, supplier_ref, manufacturer_ref, ean, designation,
                                   public_price_cents, net_price_cents, discount_rate, discount_family, match_status, match_reason)
      values (cid, p_supplier_id, item, o->>'supplier_ref', o->>'manufacturer_ref', o->>'ean', o->>'designation',
              (o->>'public_price_cents')::bigint, (o->>'net_price_cents')::bigint, (o->>'discount_rate')::numeric, o->>'discount_family',
              'certain', 'Nouvel article');
    end if;
    item := null;
  end loop;

  for o in select * from jsonb_array_elements(p_offers) loop
    if p_target = 'materiel' then
      insert into supplier_offers as so (company_id, supplier_id, product_id, supplier_ref, manufacturer_ref, ean, designation,
                                         public_price_cents, net_price_cents, discount_rate, discount_family, match_status, match_reason)
      values (cid, p_supplier_id, (o->>'item_id')::uuid, o->>'supplier_ref', o->>'manufacturer_ref', o->>'ean', o->>'designation',
              (o->>'public_price_cents')::bigint, (o->>'net_price_cents')::bigint, (o->>'discount_rate')::numeric, o->>'discount_family',
              o->>'match_status', o->>'match_reason')
      on conflict (supplier_id, product_id) do update set
        supplier_ref       = excluded.supplier_ref,
        manufacturer_ref   = excluded.manufacturer_ref,
        ean                = coalesce(excluded.ean, so.ean),
        designation        = coalesce(excluded.designation, so.designation),
        public_price_cents = excluded.public_price_cents,
        net_price_cents    = excluded.net_price_cents,
        discount_rate      = case when o ? 'discount_rate' then excluded.discount_rate else so.discount_rate end,
        discount_family    = coalesce(excluded.discount_family, so.discount_family),
        match_status       = case when so.match_status in ('certain', 'manuel') then so.match_status else excluded.match_status end,
        updated_at         = now();
    else
      insert into supplier_offers as so (company_id, supplier_id, accessory_id, supplier_ref, manufacturer_ref, ean, designation,
                                         public_price_cents, net_price_cents, discount_rate, discount_family, match_status, match_reason)
      values (cid, p_supplier_id, (o->>'item_id')::uuid, o->>'supplier_ref', o->>'manufacturer_ref', o->>'ean', o->>'designation',
              (o->>'public_price_cents')::bigint, (o->>'net_price_cents')::bigint, (o->>'discount_rate')::numeric, o->>'discount_family',
              o->>'match_status', o->>'match_reason')
      on conflict (supplier_id, accessory_id) do update set
        supplier_ref       = excluded.supplier_ref,
        manufacturer_ref   = excluded.manufacturer_ref,
        ean                = coalesce(excluded.ean, so.ean),
        designation        = coalesce(excluded.designation, so.designation),
        public_price_cents = excluded.public_price_cents,
        net_price_cents    = excluded.net_price_cents,
        discount_rate      = case when o ? 'discount_rate' then excluded.discount_rate else so.discount_rate end,
        discount_family    = coalesce(excluded.discount_family, so.discount_family),
        match_status       = case when so.match_status in ('certain', 'manuel') then so.match_status else excluded.match_status end,
        updated_at         = now();
    end if;
  end loop;

  if p_target = 'materiel' then
    for r in select * from jsonb_array_elements(p_updates) loop
      update products set
        range_name           = coalesce(r->>'range_name', range_name),
        cooling_kw           = coalesce((r->>'cooling_kw')::numeric, cooling_kw),
        heating_kw           = coalesce((r->>'heating_kw')::numeric, heating_kw),
        max_outlets          = coalesce((r->>'max_outlets')::smallint, max_outlets),
        link_diameters       = coalesce(r->>'link_diameters', link_diameters),
        precharged_length_m  = coalesce((r->>'precharged_length_m')::numeric, precharged_length_m),
        extra_charge_g_per_m = coalesce((r->>'extra_charge_g_per_m')::integer, extra_charge_g_per_m),
        active               = true
      where id = (r->>'id')::uuid and company_id = cid;
    end loop;
  end if;

  update suppliers set last_price_update_at = now() where id = p_supplier_id;
  return imp;
end $$;

revoke all on function public.apply_supplier_import(uuid, text, jsonb, text, text, text, jsonb, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.apply_supplier_import(uuid, text, jsonb, text, text, text, jsonb, jsonb, jsonb, jsonb) to authenticated;

-- L'ancien import (un seul fournisseur par article) est remplacé.
drop function public.apply_catalog_import(text, text, jsonb, text, jsonb, jsonb, jsonb);

-- Prix de référence recalculés par le serveur (src/lib/suppliers/pricing.ts) :
-- p_products    : [{ "id": "...", "public_price_cents": 123 }]
-- p_accessories : [{ "id": "...", "public_price_cents": 123 | null, "floor_purchase_cents": 45 | null }]
create or replace function public.apply_reference_prices(p_products jsonb, p_accessories jsonb)
returns void language plpgsql security invoker set search_path = public as $$
declare cid uuid := current_company_id();
begin
  if cid is null then raise exception 'Non authentifié'; end if;
  update products p set public_price_cents = (x->>'public_price_cents')::bigint
  from jsonb_array_elements(p_products) x
  where p.id = (x->>'id')::uuid and p.company_id = cid and (x->>'public_price_cents') is not null
    and p.public_price_cents is distinct from (x->>'public_price_cents')::bigint;

  update accessories a set
    public_price_cents   = (x->>'public_price_cents')::bigint,
    floor_purchase_cents = (x->>'floor_purchase_cents')::bigint,
    purchase_price_cents = case when (x->>'public_price_cents') is null then (x->>'floor_purchase_cents')::bigint else a.purchase_price_cents end
  from jsonb_array_elements(p_accessories) x
  where a.id = (x->>'id')::uuid and a.company_id = cid
    and ((x->>'public_price_cents') is not null or (x->>'floor_purchase_cents') is not null);
end $$;
revoke all on function public.apply_reference_prices(jsonb, jsonb) from public, anon;
grant execute on function public.apply_reference_prices(jsonb, jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- Passage au multi-fournisseurs : « Fournisseur principal »
-- Chaque article existant devient une offre de son fournisseur (ou du
-- « Fournisseur principal »), avec les remises actuelles :
--   remise de la marque → remise « marque » du fournisseur ;
--   remise propre au produit / à l'accessoire → remise « référence ».
-- -----------------------------------------------------------------------------
create or replace function public.setup_main_supplier(p_company uuid)
returns void language plpgsql security definer set search_path = public as $$
declare main uuid;
begin
  if exists (select 1 from products where company_id = p_company and supplier_id is null)
     or exists (select 1 from accessories where company_id = p_company and supplier_id is null) then
    insert into suppliers (company_id, name) values (p_company, 'Fournisseur principal')
    on conflict (company_id, name) do nothing;
    select id into main from suppliers where company_id = p_company and name = 'Fournisseur principal';
  end if;

  insert into supplier_offers (company_id, supplier_id, product_id, manufacturer_ref, public_price_cents, discount_rate, discount_family, match_status, match_reason)
  select p.company_id, coalesce(p.supplier_id, main), p.id, p.reference, p.public_price_cents, p.discount_rate, p.range_name, 'manuel', 'Reprise du catalogue'
  from products p
  where p.company_id = p_company
  on conflict (supplier_id, product_id) do nothing;

  insert into supplier_offers (company_id, supplier_id, accessory_id, manufacturer_ref, designation, public_price_cents, net_price_cents, discount_rate, match_status, match_reason)
  select a.company_id, coalesce(a.supplier_id, main), a.id, a.reference, a.name, a.public_price_cents,
         case when a.public_price_cents is null then a.purchase_price_cents end,
         case when a.public_price_cents is not null and a.discount_rate > 0 then a.discount_rate end,
         'manuel', 'Reprise du catalogue'
  from accessories a
  where a.company_id = p_company
  on conflict (supplier_id, accessory_id) do nothing;

  insert into supplier_discounts (company_id, supplier_id, brand_id, rate)
  select distinct b.company_id, o.supplier_id, b.id, b.discount_rate
  from brands b
  join products p on p.brand_id = b.id
  join supplier_offers o on o.product_id = p.id
  where b.company_id = p_company and b.discount_rate > 0
  on conflict (supplier_id, brand_id) do nothing;

  -- Plancher accessoires : prix net actuel
  update accessories set floor_purchase_cents = case
      when public_price_cents is null then purchase_price_cents
      else round(public_price_cents * (1 - discount_rate))::bigint end
  where company_id = p_company and floor_purchase_cents is null;

  update suppliers set last_price_update_at = coalesce(last_price_update_at, now()) where company_id = p_company;
end $$;
revoke all on function public.setup_main_supplier(uuid) from public, anon, authenticated;

do $$
declare c record;
begin
  for c in select id from companies loop
    perform setup_main_supplier(c.id);
  end loop;
end $$;

-- Nouvelles entreprises : même départ (catalogue exemple chez « Fournisseur principal »)
create or replace function public.create_company_for_current_user(p_legal_name text, p_full_name text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  cid uuid;
  user_email text;
begin
  if auth.uid() is null then raise exception 'Non authentifié'; end if;
  select company_id into cid from profiles where id = auth.uid();
  if cid is not null then return cid; end if;
  select email into user_email from auth.users where id = auth.uid();
  insert into companies (legal_name, email) values (coalesce(nullif(trim(p_legal_name), ''), 'Mon entreprise'), user_email) returning id into cid;
  insert into profiles (id, company_id, full_name, role, access_role, email) values (auth.uid(), cid, p_full_name, 'owner', 'admin', user_email);
  insert into subscriptions (company_id) values (cid);
  insert into settings_coefficients (company_id, sizing, labor_days) values (cid, default_sizing_coefficients(), default_labor_days());
  perform seed_example_catalog(cid);
  perform seed_example_accessories_v2(cid);
  perform setup_main_supplier(cid);
  return cid;
end $$;

-- >>>>> 20261116000011_plans.sql
-- =============================================================================
-- Bloc A : plans, implantation, PDF techniques.
--
--  - un plan par niveau et par devis : image du plan, échelle, flèche du nord,
--    lecture de l'IA (brouillon), implantation (repères et tracés) ;
--  - surface totale du logement (contrôle à 10 % de la somme des pièces) ;
--  - fiche technique fabricant (PDF) par produit du catalogue ;
--  - stockage privé : plans (membres) et fiches techniques (écriture admin).
-- Aucun prix ni marge dans ces données : lisibles par tous les membres.
-- =============================================================================

alter table projects add column total_area_m2 numeric(7,2) check (total_area_m2 is null or (total_area_m2 > 0 and total_area_m2 < 10000));

alter table products add column datasheet_path text;
alter table products add column datasheet_name text;

create table quote_plans (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references companies(id) on delete cascade,
  quote_id        uuid not null references quotes(id) on delete cascade,
  level           smallint not null default 0 check (level between -1 and 5),
  label           text,
  image_path      text not null,             -- bucket « plans » : <entreprise>/<devis>/…
  width_px        integer not null check (width_px between 50 and 10000),
  height_px       integer not null check (height_px between 50 and 10000),
  source_name     text,
  source_kind     text not null default 'image' check (source_kind in ('pdf', 'image')),
  scale_m_per_px  numeric(12,8) check (scale_m_per_px is null or scale_m_per_px > 0),
  scale_source    text check (scale_source is null or scale_source in ('cotes', 'surfaces', 'mesure')),
  north_deg       numeric(6,2) check (north_deg is null or (north_deg >= 0 and north_deg < 360)),
  draft           jsonb,                     -- brouillon (pièces, fenêtres, cotes) issu de l'IA ou dessiné
  layout          jsonb not null default '{"markers": [], "routes": []}'::jsonb,
  analyzed_at     timestamptz,
  validated_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (quote_id, level)
);
create index on quote_plans (company_id);
create trigger quote_plans_company before insert or update on quote_plans for each row execute function public.check_company_refs();

-- Pièces créées depuis un plan : rattachées au plan (remplacées si le plan est revalidé)
alter table rooms add column plan_id uuid references quote_plans(id) on delete set null;

alter table quote_plans enable row level security;
create policy quote_plans_select on quote_plans for select using (company_id = current_company_id());
create policy quote_plans_insert on quote_plans for insert with check (company_id = current_company_id() and company_can_write());
create policy quote_plans_update on quote_plans for update
  using (company_id = current_company_id() and company_can_write())
  with check (company_id = current_company_id() and company_can_write());
create policy quote_plans_delete on quote_plans for delete using (company_id = current_company_id() and company_can_write());

-- -----------------------------------------------------------------------------
-- Stockage privé
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public) values ('plans', 'plans', false) on conflict do nothing;
insert into storage.buckets (id, name, public) values ('datasheets', 'datasheets', false) on conflict do nothing;

-- Plans : tous les membres (les techniciens font des devis), écriture si l'abonnement le permet
create policy plans_read on storage.objects for select
  using (bucket_id = 'plans' and (storage.foldername(name))[1] = current_company_id()::text);
create policy plans_write on storage.objects for insert
  with check (bucket_id = 'plans' and (storage.foldername(name))[1] = current_company_id()::text and company_can_write());
create policy plans_update on storage.objects for update
  using (bucket_id = 'plans' and (storage.foldername(name))[1] = current_company_id()::text and company_can_write());
create policy plans_delete on storage.objects for delete
  using (bucket_id = 'plans' and (storage.foldername(name))[1] = current_company_id()::text and company_can_write());

-- Fiches techniques : lecture par tous les membres, écriture par les administrateurs
create policy datasheets_read on storage.objects for select
  using (bucket_id = 'datasheets' and (storage.foldername(name))[1] = current_company_id()::text);
create policy datasheets_write on storage.objects for insert
  with check (bucket_id = 'datasheets' and (storage.foldername(name))[1] = current_company_id()::text and current_is_admin());
create policy datasheets_update on storage.objects for update
  using (bucket_id = 'datasheets' and (storage.foldername(name))[1] = current_company_id()::text and current_is_admin());
create policy datasheets_delete on storage.objects for delete
  using (bucket_id = 'datasheets' and (storage.foldername(name))[1] = current_company_id()::text and current_is_admin());

-- Nom de la fiche technique visible des techniciens (vue sans coûts du catalogue)
create or replace view catalog_products_public with (security_barrier) as
  select p.id, p.company_id, p.brand_id, b.name as brand_name, p.range_name, p.reference, p.type,
         p.cooling_kw, p.heating_kw, p.max_outlets, p.max_indoor_ratio, p.link_diameters,
         p.precharged_length_m, p.extra_charge_g_per_m, p.is_example, p.active,
         round(p.public_price_cents * b.sale_coefficient)::bigint as sale_price_cents,
         p.datasheet_path, p.datasheet_name
  from products p join brands b on b.id = p.brand_id
  where p.company_id = current_company_id();

-- >>>>> 20261117000012_placement_and_site.sql
-- =============================================================================
-- A5 : règles et suggestions d'implantation ; A6 : mode chantier.
--
--  - données techniques des produits (fluide, charge usine, longueurs et
--    dénivelé maximum, dégagements de la notice) ;
--  - réglages des règles par entreprise ; numéro d'attestation de capacité ;
--  - chantier : avancement, photos placées sur le plan, écarts (le surcoût et
--    l'impact sur la marge sont dans une table cloisonnée), mise en service,
--    fiche fluides, procès-verbal de réception signé.
-- =============================================================================

alter table products add column refrigerant text check (refrigerant is null or refrigerant in ('R32', 'R410A', 'R290', 'R454B', 'autre'));
alter table products add column factory_charge_kg numeric(6,3) check (factory_charge_kg is null or (factory_charge_kg > 0 and factory_charge_kg < 100));
alter table products add column max_link_m numeric(5,1) check (max_link_m is null or max_link_m > 0);
alter table products add column max_height_diff_m numeric(5,1) check (max_height_diff_m is null or max_height_diff_m >= 0);
-- dégagements en cm : { "top": 15, "left": 10, "right": 10, "bottom": 200, "front": 50, "rear": 15 }
alter table products add column clearances jsonb not null default '{}'::jsonb check (jsonb_typeof(clearances) = 'object');

alter table companies add column placement_rules jsonb not null default '{}'::jsonb check (jsonb_typeof(placement_rules) = 'object');
alter table companies add column fluid_capacity_number text;
-- Migration 9 : chaque nouvelle colonne de companies doit être accordée explicitement
grant select (placement_rules, fluid_capacity_number) on public.companies to authenticated;

alter table quote_plans add column layout_validated_at timestamptz;

-- -----------------------------------------------------------------------------
-- Chantier
-- -----------------------------------------------------------------------------
create table site_jobs (
  quote_id       uuid primary key references quotes(id) on delete cascade,
  company_id     uuid not null references companies(id) on delete cascade,
  status         text not null default 'a_venir' check (status in ('a_venir', 'en_cours', 'termine')),
  checks         jsonb not null default '{}'::jsonb,   -- { élément : { "at": "...", "by": "..." } }
  items_total    integer not null default 0 check (items_total >= 0),
  items_done     integer not null default 0 check (items_done >= 0),
  commissioning  jsonb not null default '{}'::jsonb,   -- relevés de mise en service
  fluid_form     jsonb not null default '{}'::jsonb,   -- fiche d'intervention fluides
  reception      jsonb,                                -- PV : réserves, signataire, date, signature
  started_at     timestamptz,
  finished_at    timestamptz,
  updated_at     timestamptz not null default now()
);
create trigger site_jobs_company before insert or update on site_jobs for each row execute function public.check_company_refs();

create table site_photos (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  quote_id    uuid not null references quotes(id) on delete cascade,
  path        text not null,                 -- bucket « chantier »
  element_id  text,                          -- repère ou tracé de l'implantation
  level       smallint,
  x           numeric(10,2),
  y           numeric(10,2),
  kind        text not null default 'autre' check (kind in ('avant', 'apres', 'passage', 'etiquette', 'autre')),
  caption     text,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index on site_photos (quote_id);
create trigger site_photos_company before insert or update on site_photos for each row execute function public.check_company_refs();

create table site_deviations (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references companies(id) on delete cascade,
  quote_id         uuid not null references quotes(id) on delete cascade,
  element_id       text,
  kind             text not null check (kind in ('longueur', 'carottage', 'pompe', 'materiel', 'autre')),
  equipment_key    text,
  quantity         numeric(10,2) check (quantity is null or quantity > 0),
  accessory_id     uuid references accessories(id) on delete set null,
  description      text not null,
  status           text not null default 'en_attente' check (status in ('en_attente', 'avenant_envoye', 'accepte', 'refuse', 'absorbe')),
  amendment_number smallint,
  created_by       uuid references auth.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  decided_by       uuid references auth.users(id) on delete set null,
  decided_at       timestamptz
);
create index on site_deviations (company_id, status);
create trigger site_deviations_company before insert or update on site_deviations for each row execute function public.check_company_refs();

-- Surcoût et impact sur la marge : lecture réservée aux membres autorisés (comme la marge du devis)
create table site_deviation_costs (
  deviation_id              uuid primary key references site_deviations(id) on delete cascade,
  company_id                uuid not null references companies(id) on delete cascade,
  lines                     jsonb not null default '[]'::jsonb,
  extra_purchase_cents      bigint not null default 0,
  extra_sale_cents          bigint not null default 0,
  margin_if_billed_cents    bigint not null default 0,
  margin_if_absorbed_cents  bigint not null default 0,
  computed_at               timestamptz not null default now()
);

alter table site_jobs            enable row level security;
alter table site_photos          enable row level security;
alter table site_deviations      enable row level security;
alter table site_deviation_costs enable row level security;

do $$
declare t text;
begin
  foreach t in array array['site_jobs', 'site_photos'] loop
    execute format('create policy %1$s_select on %1$s for select using (company_id = current_company_id())', t);
    execute format('create policy %1$s_write on %1$s for all using (company_id = current_company_id() and company_can_write()) with check (company_id = current_company_id() and company_can_write())', t);
  end loop;
end $$;

-- Écarts : tout membre signale ; seuls les administrateurs décident (statut)
create policy site_deviations_select on site_deviations for select using (company_id = current_company_id());
create policy site_deviations_insert on site_deviations for insert
  with check (company_id = current_company_id() and company_can_write() and status = 'en_attente' and created_by = auth.uid());
create policy site_deviations_update on site_deviations for update
  using (company_id = current_company_id() and company_can_write() and current_is_admin())
  with check (company_id = current_company_id() and company_can_write() and current_is_admin());
create policy site_deviations_delete on site_deviations for delete
  using (company_id = current_company_id() and company_can_write() and (current_is_admin() or (created_by = auth.uid() and status = 'en_attente')));

create policy site_deviation_costs_select on site_deviation_costs for select using (company_id = current_company_id() and current_can_see_margins());
create policy site_deviation_costs_write on site_deviation_costs for all
  using (company_id = current_company_id() and current_can_see_margins() and company_can_write())
  with check (company_id = current_company_id() and current_can_see_margins() and company_can_write());

-- Photos et signatures du chantier
insert into storage.buckets (id, name, public) values ('chantier', 'chantier', false) on conflict do nothing;
create policy chantier_read on storage.objects for select
  using (bucket_id = 'chantier' and (storage.foldername(name))[1] = current_company_id()::text);
create policy chantier_write on storage.objects for insert
  with check (bucket_id = 'chantier' and (storage.foldername(name))[1] = current_company_id()::text and company_can_write());
create policy chantier_delete on storage.objects for delete
  using (bucket_id = 'chantier' and (storage.foldername(name))[1] = current_company_id()::text and company_can_write());

-- >>>>> 20261125000013_validation_fixes.sql
-- =============================================================================
-- Retours de validation :
--  - avenants : montants enregistrés (lisibles par tous : prix de vente) pour que
--    le tableau de bord compte devis signé + avenants acceptés ;
--  - support de fixation : rôles d'accessoires ajoutés automatiquement au devis ;
--  - fiche d'intervention fluides (CERFA 15497*04, France) : paramètres du compte
--    (pays, détecteur de fuite), numéro de fiche unique par compte, SIRET du client.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Avenants
-- -----------------------------------------------------------------------------
create table quote_amendments (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references companies(id) on delete cascade,
  quote_id        uuid not null references quotes(id) on delete cascade,
  number          smallint not null check (number between 1 and 99),
  status          text not null default 'envoye' check (status in ('envoye', 'accepte', 'refuse')),
  total_ht_cents  bigint not null check (total_ht_cents >= 0),
  total_ttc_cents bigint not null check (total_ttc_cents >= 0),
  created_at      timestamptz not null default now(),
  decided_at      timestamptz,
  unique (quote_id, number)
);
create index on quote_amendments (company_id, status, decided_at);
create trigger quote_amendments_company before insert or update on quote_amendments for each row execute function public.check_company_refs();

alter table quote_amendments enable row level security;
create policy quote_amendments_select on quote_amendments for select using (company_id = current_company_id());
create policy quote_amendments_write on quote_amendments for all
  using (company_id = current_company_id() and company_can_write() and current_is_admin())
  with check (company_id = current_company_id() and company_can_write() and current_is_admin());

-- -----------------------------------------------------------------------------
-- Support de fixation : nouveaux rôles d'accessoires
-- -----------------------------------------------------------------------------
alter table accessories drop constraint if exists accessories_auto_role_check;
alter table accessories add constraint accessories_auto_role_check check (auto_role is null or auto_role in (
  'liaison', 'support_mural', 'support_sol', 'goulotte', 'condensats', 'pompe_relevage',
  'cable_alim', 'cable_liaison', 'disjoncteur', 'gaz',
  'plenum', 'gaine', 'bouche_soufflage', 'grille_reprise',
  'registre_zonage', 'thermostat_zone', 'module_zonage',
  'fixation_chimique', 'fixation_ite', 'support_toiture'
));

-- Exemples (catalogue de démonstration) pour les entreprises existantes et nouvelles
create or replace function public.seed_example_fixations(p_company_id uuid)
returns void language sql security definer set search_path = public as $$
  insert into accessories (company_id, category, name, unit, public_price_cents, discount_rate, is_example, auto_role)
  select p_company_id, 'support', v.name, 'u', v.price, 0.30, true, v.role
  from (values
    ('Kit de scellement chimique (résine + tiges filetées)', 3900::bigint, 'fixation_chimique'),
    ('Fixation spéciale isolation par l''extérieur (déport + rupteur)', 14900::bigint, 'fixation_ite'),
    ('Support toiture / terrasse (plots anti-vibratiles + lestage)', 18900::bigint, 'support_toiture')
  ) as v(name, price, role)
  where not exists (select 1 from accessories a where a.company_id = p_company_id and a.auto_role = v.role)
$$;
revoke all on function public.seed_example_fixations(uuid) from public, anon, authenticated;

do $$
declare c record;
begin
  for c in select distinct company_id from accessories where is_example loop
    perform seed_example_fixations(c.company_id);
  end loop;
end $$;

-- Le « Fournisseur principal » porte aussi ces exemples (prix d'achat multi-fournisseurs)
insert into supplier_offers (company_id, supplier_id, accessory_id, manufacturer_ref, designation, public_price_cents, discount_rate, match_status, match_reason)
select a.company_id, s.id, a.id, null, a.name, a.public_price_cents, a.discount_rate, 'manuel', 'Catalogue d''exemple'
from accessories a
join suppliers s on s.company_id = a.company_id and s.name = 'Fournisseur principal'
where a.auto_role in ('fixation_chimique', 'fixation_ite', 'support_toiture') and a.is_example
on conflict (supplier_id, accessory_id) do nothing;
update accessories set floor_purchase_cents = round(public_price_cents * (1 - discount_rate))::bigint
where auto_role in ('fixation_chimique', 'fixation_ite', 'support_toiture') and is_example and floor_purchase_cents is null;

create or replace function public.create_company_for_current_user(p_legal_name text, p_full_name text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  cid uuid;
  user_email text;
begin
  if auth.uid() is null then raise exception 'Non authentifié'; end if;
  select company_id into cid from profiles where id = auth.uid();
  if cid is not null then return cid; end if;
  select email into user_email from auth.users where id = auth.uid();
  insert into companies (legal_name, email) values (coalesce(nullif(trim(p_legal_name), ''), 'Mon entreprise'), user_email) returning id into cid;
  insert into profiles (id, company_id, full_name, role, access_role, email) values (auth.uid(), cid, p_full_name, 'owner', 'admin', user_email);
  insert into subscriptions (company_id) values (cid);
  insert into settings_coefficients (company_id, sizing, labor_days) values (cid, default_sizing_coefficients(), default_labor_days());
  perform seed_example_catalog(cid);
  perform seed_example_accessories_v2(cid);
  perform seed_example_fixations(cid);
  perform setup_main_supplier(cid);
  return cid;
end $$;

-- -----------------------------------------------------------------------------
-- Fiche d'intervention fluides : paramètres du compte, numéro unique
-- -----------------------------------------------------------------------------
alter table companies add column country text not null default 'FR' check (country in ('FR', 'BE', 'LU', 'CH', 'ES', 'DE', 'AT', 'IT', 'GB', 'IE', 'PT', 'NL', 'autre'));
alter table companies add column leak_detector_id text;
alter table companies add column leak_detector_checked_on date;
grant select (country, leak_detector_id, leak_detector_checked_on) on public.companies to authenticated;

alter table clients add column siret text check (siret is null or siret ~ '^[0-9]{14}$');

create table fluid_form_counters (
  company_id  uuid primary key references companies(id) on delete cascade,
  last_number integer not null default 0
);
alter table fluid_form_counters enable row level security;
-- aucune politique : accès uniquement par la fonction ci-dessous

-- Numéro de fiche unique par compte (« FI-2026-0001 »), attribué une seule fois par chantier.
create or replace function public.assign_fluid_form_number(p_quote_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  cid uuid := current_company_id();
  existing text;
  n integer;
begin
  if cid is null or not company_can_write() then raise exception 'Non autorisé'; end if;
  if not exists (select 1 from quotes where id = p_quote_id and company_id = cid) then raise exception 'Devis inconnu'; end if;
  select fluid_form->>'number' into existing from site_jobs where quote_id = p_quote_id for update;
  if existing is not null and existing <> '' then return existing; end if;
  insert into fluid_form_counters (company_id, last_number) values (cid, 1)
  on conflict (company_id) do update set last_number = fluid_form_counters.last_number + 1
  returning last_number into n;
  existing := format('FI-%s-%s', to_char(now() at time zone 'Europe/Paris', 'YYYY'), lpad(n::text, 4, '0'));
  insert into site_jobs (quote_id, company_id, fluid_form) values (p_quote_id, cid, jsonb_build_object('number', existing))
  on conflict (quote_id) do update set fluid_form = site_jobs.fluid_form || jsonb_build_object('number', existing), updated_at = now();
  return existing;
end $$;
revoke all on function public.assign_fluid_form_number(uuid) from public, anon;
grant execute on function public.assign_fluid_form_number(uuid) to authenticated;

-- >>>>> 20261126000014_reference_catalog.sql
-- =============================================================================
-- Catalogues et remises — étape 1.
--
--  - CATALOGUE COMMUN, tenu par l'éditeur de ClimDevis (administrateurs plateforme) :
--    marques, produits (référence fabricant, famille, données techniques) et
--    tarifs fabricants datés (brouillon → publié).
--    ⚠ Aucune publication sans ACCORD ÉCRIT de la marque (date + justificatif) :
--    contrôlé en base, la marque reste invisible des artisans tant que l'accord manque.
--  - Rattachement des produits de chaque compte au catalogue commun : à la
--    publication d'un tarif, prix publics mis à jour automatiquement, avec
--    historique et notification. Les devis émis gardent leurs prix (lignes figées).
--  - Tarifs PERSONNELS : date du tarif, correspondance des colonnes par marque ;
--    réservés au compte (RLS habituelle), jamais partagés.
--  - Signalement d'un produit manquant ; seuil d'alerte « tarif ancien » par compte.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Administrateurs de la plateforme (l'éditeur). Ajout manuel, par SQL.
-- -----------------------------------------------------------------------------
create table platform_admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table platform_admins enable row level security;
-- aucune politique : lecture uniquement via is_platform_admin()

create or replace function public.is_platform_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from platform_admins where user_id = auth.uid())
$$;
revoke all on function public.is_platform_admin() from public, anon;
grant execute on function public.is_platform_admin() to authenticated;

-- -----------------------------------------------------------------------------
-- Catalogue commun
-- -----------------------------------------------------------------------------
create table ref_brands (
  id                   uuid primary key default gen_random_uuid(),
  name                 text not null,
  agreement_status     text not null default 'aucun' check (agreement_status in ('aucun', 'demande', 'obtenu', 'refuse')),
  agreement_date       date,
  agreement_proof_path text,            -- bucket privé « ref-accords »
  agreement_contact    text,
  notes                text,
  created_at           timestamptz not null default now(),
  -- « accord obtenu » exige la date ET le justificatif
  check (agreement_status <> 'obtenu' or (agreement_date is not null and agreement_proof_path is not null))
);
create unique index ref_brands_name on ref_brands (lower(name));

create table ref_products (
  id                   uuid primary key default gen_random_uuid(),
  brand_id             uuid not null references ref_brands(id) on delete cascade,
  manufacturer_ref     text not null check (length(trim(manufacturer_ref)) > 0),
  designation          text,
  type                 text check (type is null or type in ('ue_mono', 'ue_multi', 'ui_murale', 'ui_console', 'ui_cassette', 'ui_gainable', 'accessoire')),
  family               text,             -- famille / gamme du tarif fabricant (remises par famille)
  range_name           text,
  ean                  text check (ean is null or ean ~ '^[0-9]{8,14}$'),
  cooling_kw           numeric(5,2) check (cooling_kw is null or cooling_kw > 0),
  heating_kw           numeric(5,2) check (heating_kw is null or heating_kw > 0),
  max_outlets          smallint check (max_outlets is null or max_outlets between 1 and 8),
  refrigerant          text check (refrigerant is null or refrigerant in ('R32', 'R410A', 'R290', 'R454B', 'autre')),
  factory_charge_kg    numeric(6,3) check (factory_charge_kg is null or (factory_charge_kg > 0 and factory_charge_kg < 100)),
  precharged_length_m  numeric(5,1) check (precharged_length_m is null or precharged_length_m >= 0),
  extra_charge_g_per_m smallint check (extra_charge_g_per_m is null or extra_charge_g_per_m >= 0),
  link_diameters       text,
  max_link_m           numeric(5,1) check (max_link_m is null or max_link_m > 0),
  max_height_diff_m    numeric(5,1) check (max_height_diff_m is null or max_height_diff_m >= 0),
  discontinued_at      date,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create unique index ref_products_ref on ref_products (brand_id, upper(manufacturer_ref));

create table ref_price_lists (
  id             uuid primary key default gen_random_uuid(),
  brand_id       uuid not null references ref_brands(id) on delete cascade,
  effective_date date not null,                 -- date d'effet du tarif fabricant
  source_label   text,                          -- ex. « Tarif public Daikin janvier 2027 (PDF) »
  status         text not null default 'brouillon' check (status in ('brouillon', 'publie', 'archive')),
  summary        jsonb not null default '{}'::jsonb check (jsonb_typeof(summary) = 'object'),
  created_at     timestamptz not null default now(),
  published_at   timestamptz,
  published_by   uuid references auth.users(id) on delete set null
);
create index on ref_price_lists (brand_id, status, effective_date desc);
-- un seul tarif publié (en vigueur) par marque
create unique index ref_price_lists_one_published on ref_price_lists (brand_id) where status = 'publie';

create table ref_prices (
  price_list_id      uuid not null references ref_price_lists(id) on delete cascade,
  ref_product_id     uuid not null references ref_products(id) on delete cascade,
  public_price_cents bigint not null check (public_price_cents >= 0),
  family             text,
  primary key (price_list_id, ref_product_id)
);
create index on ref_prices (ref_product_id);

-- Garde-fou juridique : publication impossible sans accord écrit de la marque.
create or replace function public.ref_price_list_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare b ref_brands;
begin
  if new.status = 'publie' and (tg_op = 'INSERT' or old.status is distinct from 'publie') then
    select * into b from ref_brands where id = new.brand_id;
    if b.agreement_status <> 'obtenu' or b.agreement_date is null or b.agreement_proof_path is null then
      raise exception 'Publication refusée : accord écrit de la marque % non enregistré (date + justificatif)', b.name;
    end if;
  end if;
  return new;
end $$;
create trigger ref_price_lists_guard before insert or update on ref_price_lists for each row execute function public.ref_price_list_guard();

-- Lecture : artisans = marques avec accord + tarifs publiés ; prix réservés aux membres
-- autorisés à voir les marges (comme le reste du catalogue). Écriture : plateforme.
alter table ref_brands      enable row level security;
alter table ref_products    enable row level security;
alter table ref_price_lists enable row level security;
alter table ref_prices      enable row level security;

create policy ref_brands_select on ref_brands for select using (agreement_status = 'obtenu' or is_platform_admin());
create policy ref_brands_admin on ref_brands for all using (is_platform_admin()) with check (is_platform_admin());

create policy ref_products_select on ref_products for select
  using (is_platform_admin() or exists (select 1 from ref_brands b where b.id = brand_id and b.agreement_status = 'obtenu'));
create policy ref_products_admin on ref_products for all using (is_platform_admin()) with check (is_platform_admin());

create policy ref_price_lists_select on ref_price_lists for select
  using (is_platform_admin() or (status in ('publie', 'archive') and exists (select 1 from ref_brands b where b.id = brand_id and b.agreement_status = 'obtenu')));
create policy ref_price_lists_admin on ref_price_lists for all using (is_platform_admin()) with check (is_platform_admin());

create policy ref_prices_select on ref_prices for select
  using (is_platform_admin() or (current_can_see_margins() and exists (
    select 1 from ref_price_lists l join ref_brands b on b.id = l.brand_id
    where l.id = price_list_id and l.status in ('publie', 'archive') and b.agreement_status = 'obtenu')));
create policy ref_prices_admin on ref_prices for all using (is_platform_admin()) with check (is_platform_admin());

-- Justificatifs d'accord : espace privé, plateforme seulement
insert into storage.buckets (id, name, public) values ('ref-accords', 'ref-accords', false) on conflict do nothing;
create policy ref_accords_admin_select on storage.objects for select using (bucket_id = 'ref-accords' and is_platform_admin());
create policy ref_accords_admin_insert on storage.objects for insert with check (bucket_id = 'ref-accords' and is_platform_admin());
create policy ref_accords_admin_delete on storage.objects for delete using (bucket_id = 'ref-accords' and is_platform_admin());

-- -----------------------------------------------------------------------------
-- Comptes : rattachement, familles, tarifs personnels, seuil d'alerte
-- -----------------------------------------------------------------------------
alter table brands   add column ref_brand_id uuid references ref_brands(id) on delete set null;
alter table brands   add column tariff_date date;                                   -- date du tarif personnel importé
alter table brands   add column column_mapping jsonb not null default '{}'::jsonb check (jsonb_typeof(column_mapping) = 'object');
alter table products add column ref_product_id uuid references ref_products(id) on delete set null;
alter table products add column family text;                                       -- famille du tarif fabricant
create unique index products_company_ref on products (company_id, ref_product_id) where ref_product_id is not null;
alter table suppliers       add column tariff_date date;
alter table catalog_imports add column tariff_date date;

alter table companies add column tariff_alert_months smallint not null default 12 check (tariff_alert_months between 1 and 60);
grant select (tariff_alert_months) on public.companies to authenticated;

-- Historique des prix : origine « tarif commun » (écrit par publish_ref_price_list)
alter table price_history add column ref_price_list_id uuid references ref_price_lists(id) on delete set null;

-- Prix de référence recalculé depuis les tarifs distributeurs (bloc B) : un produit
-- rattaché à un tarif commun PUBLIÉ garde le prix public du fabricant.
create or replace function public.apply_reference_prices(p_products jsonb, p_accessories jsonb)
returns void language plpgsql security invoker set search_path = public as $$
declare cid uuid := current_company_id();
begin
  if cid is null then raise exception 'Non authentifié'; end if;
  update products p set public_price_cents = (x->>'public_price_cents')::bigint
  from jsonb_array_elements(p_products) x
  where p.id = (x->>'id')::uuid and p.company_id = cid and (x->>'public_price_cents') is not null
    and p.public_price_cents is distinct from (x->>'public_price_cents')::bigint
    and not public.has_published_ref_price(p.ref_product_id);

  update accessories a set
    public_price_cents   = (x->>'public_price_cents')::bigint,
    floor_purchase_cents = (x->>'floor_purchase_cents')::bigint,
    purchase_price_cents = case when (x->>'public_price_cents') is null then (x->>'floor_purchase_cents')::bigint else a.purchase_price_cents end
  from jsonb_array_elements(p_accessories) x
  where a.id = (x->>'id')::uuid and a.company_id = cid
    and ((x->>'public_price_cents') is not null or (x->>'floor_purchase_cents') is not null);
end $$;

create or replace function public.has_published_ref_price(p_ref_product_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_ref_product_id is not null and exists (
    select 1 from ref_prices p join ref_price_lists l on l.id = p.price_list_id
    where p.ref_product_id = p_ref_product_id and l.status = 'publie')
$$;
revoke all on function public.has_published_ref_price(uuid) from public, anon;
grant execute on function public.has_published_ref_price(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Notifications (nouveau tarif publié, nouveau tarif disponible…)
-- -----------------------------------------------------------------------------
create table notifications (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  kind       text not null check (kind in ('tarif_publie', 'tarif_disponible', 'produit_ajoute')),
  title      text not null,
  body       text,
  link       text,
  created_at timestamptz not null default now(),
  read_at    timestamptz
);
create index on notifications (company_id, read_at, created_at desc);
alter table notifications enable row level security;
create policy notifications_select on notifications for select using (company_id = current_company_id());
create policy notifications_read on notifications for update using (company_id = current_company_id()) with check (company_id = current_company_id());
-- seule la colonne « lu » est modifiable par les membres
revoke update on notifications from authenticated;
grant update (read_at) on notifications to authenticated;

-- -----------------------------------------------------------------------------
-- Publication d'un tarif commun : mise à jour automatique + notifications
-- -----------------------------------------------------------------------------
create or replace function public.publish_ref_price_list(p_list_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  l ref_price_lists;
  b ref_brands;
  updated integer := 0;
  companies_updated integer := 0;
  c record;
begin
  if not is_platform_admin() then raise exception 'Réservé à l''éditeur de ClimDevis'; end if;
  select * into l from ref_price_lists where id = p_list_id for update;
  if l.id is null then raise exception 'Tarif inconnu'; end if;
  if l.status <> 'brouillon' then raise exception 'Seul un tarif en brouillon peut être publié'; end if;
  select * into b from ref_brands where id = l.brand_id;

  update ref_price_lists set status = 'archive' where brand_id = l.brand_id and status = 'publie';
  -- le garde-fou (trigger) refuse ici si l'accord écrit manque
  update ref_price_lists set status = 'publie', published_at = now(), published_by = auth.uid() where id = p_list_id;
  update ref_products rp set family = coalesce(p.family, rp.family), updated_at = now()
    from ref_prices p where p.price_list_id = p_list_id and p.ref_product_id = rp.id;

  -- Produits rattachés de tous les comptes : historique, puis nouveau prix public
  insert into price_history (company_id, product_id, old_public_price_cents, new_public_price_cents, ref_price_list_id)
  select pr.company_id, pr.id, pr.public_price_cents, p.public_price_cents, p_list_id
  from products pr join ref_prices p on p.ref_product_id = pr.ref_product_id and p.price_list_id = p_list_id
  where pr.public_price_cents <> p.public_price_cents;
  for c in
    select pr.company_id, count(*) filter (where pr.public_price_cents <> p.public_price_cents) as n
    from products pr join ref_prices p on p.ref_product_id = pr.ref_product_id and p.price_list_id = p_list_id
    group by pr.company_id
  loop
    update products pr set public_price_cents = p.public_price_cents, family = coalesce(p.family, pr.family)
      from ref_prices p
      where pr.company_id = c.company_id and p.ref_product_id = pr.ref_product_id and p.price_list_id = p_list_id
        and (pr.public_price_cents <> p.public_price_cents or pr.family is distinct from coalesce(p.family, pr.family));
    updated := updated + c.n;
    companies_updated := companies_updated + 1;
    insert into notifications (company_id, kind, title, body, link)
    values (c.company_id, 'tarif_publie',
            format('Nouveau tarif %s publié', b.name),
            format('Tarif %s du %s : %s prix public(s) mis à jour automatiquement. Les devis déjà émis gardent leurs prix.', b.name, to_char(l.effective_date, 'DD/MM/YYYY'), c.n),
            '/app/catalogue');
  end loop;

  -- Comptes qui utilisent la marque sans l'avoir rattachée : « nouveau tarif disponible »
  insert into notifications (company_id, kind, title, body, link)
  select distinct br.company_id, 'tarif_disponible',
         format('Tarif %s disponible', b.name),
         format('Le tarif %s du %s est disponible dans le catalogue commun : rattachez vos produits pour des prix publics toujours à jour.', b.name, to_char(l.effective_date, 'DD/MM/YYYY')),
         '/app/catalogue'
  from brands br
  where (br.ref_brand_id = b.id or lower(br.name) = lower(b.name))
    and not exists (select 1 from products pr join ref_products rp on rp.id = pr.ref_product_id
                    where pr.company_id = br.company_id and rp.brand_id = b.id);

  update ref_price_lists set summary = summary || jsonb_build_object('updated_prices', updated, 'companies', companies_updated) where id = p_list_id;
  return jsonb_build_object('updated_prices', updated, 'companies', companies_updated);
end $$;
revoke all on function public.publish_ref_price_list(uuid) from public, anon;
grant execute on function public.publish_ref_price_list(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Signalement d'un produit manquant (artisans → éditeur)
-- -----------------------------------------------------------------------------
create table missing_product_reports (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references companies(id) on delete cascade,
  user_id          uuid not null default auth.uid() references auth.users(id) on delete cascade,
  brand_name       text not null check (length(trim(brand_name)) between 1 and 80),
  manufacturer_ref text check (manufacturer_ref is null or length(manufacturer_ref) <= 80),
  designation      text check (designation is null or length(designation) <= 200),
  comment          text check (comment is null or length(comment) <= 1000),
  status           text not null default 'nouveau' check (status in ('nouveau', 'ajoute', 'en_attente_accord', 'rejete')),
  created_at       timestamptz not null default now(),
  handled_at       timestamptz
);
create index on missing_product_reports (status, created_at desc);
alter table missing_product_reports enable row level security;
create policy missing_reports_select on missing_product_reports for select using (company_id = current_company_id() or is_platform_admin());
create policy missing_reports_insert on missing_product_reports for insert
  with check (company_id = current_company_id() and user_id = auth.uid() and status = 'nouveau' and handled_at is null);
create policy missing_reports_admin on missing_product_reports for update using (is_platform_admin()) with check (is_platform_admin());

-- >>>>> 20261127000015_personal_tariffs.sql
-- =============================================================================
-- Catalogues et remises — étape 3 : import de tarif PERSONNEL.
--
-- Règle de priorité des prix (src/lib/catalog/reference.ts) :
--  1. prix NET importé (tarif déjà remisé) : utilisé tel quel, sans remise par-dessus ;
--  2. prix PUBLIC : tarif commun publié, sinon tarif personnel / saisie — le plus récent ;
--  3. puis remise distributeur × marque (× famille) ;
--  4. source et date du prix toujours affichées (commun / importé / saisi à la main).
--
--  - tarif d'un distributeur, ou d'un FABRICANT (prix publics, on n'achète pas chez lui) ;
--  - case « prix publics / prix nets » par fichier, date du tarif ;
--  - conditionnement (couronne de 25 m…) ramené à l'unité, conservé pour l'affichage ;
--  - instantané de chaque import pour « Annuler le dernier import ».
-- Les devis émis gardent leurs prix (lignes figées) : rien ici n'y touche.
-- =============================================================================

-- Fournisseurs : distributeur (achat) ou fabricant (tarif public d'une marque)
alter table suppliers add column kind text not null default 'distributeur' check (kind in ('distributeur', 'fabricant'));
alter table suppliers add column brand_id uuid references brands(id) on delete cascade;
alter table suppliers add constraint suppliers_fabricant_brand check (kind = 'distributeur' or brand_id is not null);
create unique index suppliers_one_per_brand on suppliers (company_id, brand_id) where kind = 'fabricant';

-- Offres : date et origine du prix, conditionnement d'origine
alter table supplier_offers add column tariff_date date;
alter table supplier_offers add column price_origin text not null default 'import' check (price_origin in ('import', 'manuel'));
alter table supplier_offers add column pack_qty numeric(10,3) not null default 1 check (pack_qty > 0);
alter table supplier_offers add column pack_label text;
update supplier_offers set price_origin = 'manuel' where match_reason in ('Reprise du catalogue', 'Saisi à la main');
update supplier_offers set tariff_date = updated_at::date where tariff_date is null;

-- Articles : source et date du prix public retenu (affichage)
alter table products    add column public_price_source text check (public_price_source in ('commun', 'personnel', 'manuel'));
alter table products    add column public_price_date date;
alter table accessories add column public_price_source text check (public_price_source in ('commun', 'personnel', 'manuel'));
alter table accessories add column public_price_date date;
update products p set public_price_source = 'personnel', public_price_date = (select max(o.tariff_date) from supplier_offers o where o.product_id = p.id) where public_price_source is null;
update accessories a set public_price_source = 'personnel', public_price_date = (select max(o.tariff_date) from supplier_offers o where o.accessory_id = a.id) where public_price_source is null;

-- Imports : nature des prix, annulation
alter table catalog_imports add column price_kind text not null default 'public' check (price_kind in ('public', 'net'));
alter table catalog_imports add column undone_at timestamptz;
create policy catalog_imports_update on catalog_imports for update
  using (company_id = current_company_id() and current_can_see_margins() and current_is_admin() and company_can_write())
  with check (company_id = current_company_id() and current_can_see_margins() and current_is_admin() and company_can_write());

create table catalog_import_changes (
  id         bigserial primary key,
  import_id  uuid not null references catalog_imports(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  table_name text not null check (table_name in ('supplier_offers', 'products', 'accessories', 'brands', 'suppliers')),
  row_id     uuid not null,
  action     text not null check (action in ('created', 'updated')),
  before     jsonb
);
create index on catalog_import_changes (import_id, id);
grant usage, select on sequence catalog_import_changes_id_seq to authenticated;
alter table catalog_import_changes enable row level security;
create policy catalog_import_changes_all on catalog_import_changes for all
  using (company_id = current_company_id() and current_can_see_margins() and current_is_admin())
  with check (company_id = current_company_id() and current_can_see_margins() and current_is_admin());

-- -----------------------------------------------------------------------------
-- Import (remplace la version du bloc B) : date du tarif, prix publics / nets,
-- conditionnement, instantané pour l'annulation.
-- -----------------------------------------------------------------------------
create or replace function public.apply_supplier_import(
  p_supplier_id uuid,
  p_target text,
  p_mapping jsonb,
  p_filename text,
  p_file_hash text,
  p_source text,
  p_brands jsonb,
  p_creates jsonb,
  p_offers jsonb,
  p_updates jsonb,
  p_tariff_date date,
  p_price_kind text
) returns uuid language plpgsql security invoker set search_path = public as $$
declare
  cid  uuid := current_company_id();
  imp  uuid;
  r    jsonb;
  o    jsonb;
  item uuid;
  oid  uuid;
  prev jsonb;
  bid  uuid;
  col  text;
begin
  if cid is null then raise exception 'Non authentifié'; end if;
  if p_target not in ('materiel', 'accessoires') then raise exception 'Cible d''import invalide'; end if;
  if p_price_kind not in ('public', 'net') then raise exception 'Nature des prix invalide'; end if;
  if p_tariff_date is null or p_tariff_date > current_date + 366 then raise exception 'Date du tarif invalide'; end if;
  if not exists (select 1 from suppliers where id = p_supplier_id and company_id = cid) then raise exception 'Fournisseur inconnu'; end if;
  if p_price_kind = 'net' and exists (select 1 from suppliers where id = p_supplier_id and kind = 'fabricant') then
    raise exception 'Un tarif fabricant donne des prix publics';
  end if;
  col := case when p_target = 'materiel' then 'product_id' else 'accessory_id' end;

  insert into catalog_imports (company_id, supplier_id, target, filename, file_hash, source, created_count, updated_count, tariff_date, price_kind)
  values (cid, p_supplier_id, p_target, p_filename, p_file_hash, coalesce(p_source, 'tableur'), jsonb_array_length(p_creates), jsonb_array_length(p_offers), p_tariff_date, p_price_kind)
  returning id into imp;
  perform set_config('climdevis.import_id', imp::text, true);

  insert into catalog_import_changes (import_id, company_id, table_name, row_id, action, before)
  select imp, cid, 'suppliers', s.id, 'updated', jsonb_build_object('column_mapping', s.column_mapping, 'last_price_update_at', s.last_price_update_at, 'tariff_date', s.tariff_date)
  from suppliers s where s.id = p_supplier_id;
  update suppliers set column_mapping = column_mapping || jsonb_build_object(p_target, coalesce(p_mapping, '{}'::jsonb))
  where id = p_supplier_id;

  if p_target = 'materiel' then
    for r in select * from jsonb_array_elements(p_brands) loop
      insert into brands (company_id, name, discount_rate) values (cid, r->>'name', 0)
      on conflict (company_id, name) do nothing returning id into bid;
      if bid is not null then
        insert into catalog_import_changes (import_id, company_id, table_name, row_id, action) values (imp, cid, 'brands', bid, 'created');
      end if;
      bid := null;
    end loop;
  end if;

  for r in select * from jsonb_array_elements(p_creates) loop
    o := r->'offer';
    if p_target = 'materiel' then
      insert into products (company_id, brand_id, supplier_id, range_name, reference, type, cooling_kw, heating_kw, max_outlets,
                            link_diameters, precharged_length_m, extra_charge_g_per_m, public_price_cents, family,
                            public_price_source, public_price_date)
      select cid, br.id, p_supplier_id, r->>'range_name', r->>'reference', (r->>'type')::product_type,
             (r->>'cooling_kw')::numeric, (r->>'heating_kw')::numeric, (r->>'max_outlets')::smallint,
             r->>'link_diameters', (r->>'precharged_length_m')::numeric, (r->>'extra_charge_g_per_m')::integer,
             coalesce((o->>'public_price_cents')::bigint, (o->>'net_price_cents')::bigint), o->>'discount_family',
             'personnel', p_tariff_date
      from brands br where br.company_id = cid and br.name = r->>'brand'
      returning id into item;
      if item is null then raise exception 'Marque introuvable : %', r->>'brand'; end if;
      insert into catalog_import_changes (import_id, company_id, table_name, row_id, action) values (imp, cid, 'products', item, 'created');
      insert into supplier_offers (company_id, supplier_id, product_id, supplier_ref, manufacturer_ref, ean, designation,
                                   public_price_cents, net_price_cents, discount_rate, discount_family, match_status, match_reason,
                                   tariff_date, price_origin, pack_qty, pack_label)
      values (cid, p_supplier_id, item, o->>'supplier_ref', o->>'manufacturer_ref', o->>'ean', o->>'designation',
              (o->>'public_price_cents')::bigint, (o->>'net_price_cents')::bigint, (o->>'discount_rate')::numeric, o->>'discount_family',
              'certain', 'Nouvel article', p_tariff_date, 'import', coalesce((o->>'pack_qty')::numeric, 1), o->>'pack_label')
      returning id into oid;
    else
      insert into accessories (company_id, supplier_id, reference, category, name, diameter, unit, public_price_cents, purchase_price_cents, discount_rate,
                               public_price_source, public_price_date)
      values (cid, p_supplier_id, r->>'reference', r->>'category', r->>'name', r->>'diameter', coalesce(r->>'unit', 'u'),
              (o->>'public_price_cents')::bigint, (o->>'net_price_cents')::bigint, 0, 'personnel', p_tariff_date)
      returning id into item;
      insert into catalog_import_changes (import_id, company_id, table_name, row_id, action) values (imp, cid, 'accessories', item, 'created');
      insert into supplier_offers (company_id, supplier_id, accessory_id, supplier_ref, manufacturer_ref, ean, designation,
                                   public_price_cents, net_price_cents, discount_rate, discount_family, match_status, match_reason,
                                   tariff_date, price_origin, pack_qty, pack_label)
      values (cid, p_supplier_id, item, o->>'supplier_ref', o->>'manufacturer_ref', o->>'ean', o->>'designation',
              (o->>'public_price_cents')::bigint, (o->>'net_price_cents')::bigint, (o->>'discount_rate')::numeric, o->>'discount_family',
              'certain', 'Nouvel article', p_tariff_date, 'import', coalesce((o->>'pack_qty')::numeric, 1), o->>'pack_label')
      returning id into oid;
    end if;
    insert into catalog_import_changes (import_id, company_id, table_name, row_id, action) values (imp, cid, 'supplier_offers', oid, 'created');
    item := null;
  end loop;

  for o in select * from jsonb_array_elements(p_offers) loop
    item := (o->>'item_id')::uuid;
    if p_target = 'materiel' then
      select to_jsonb(so) into prev from supplier_offers so where so.supplier_id = p_supplier_id and so.product_id = item;
    else
      select to_jsonb(so) into prev from supplier_offers so where so.supplier_id = p_supplier_id and so.accessory_id = item;
    end if;
    insert into supplier_offers as so (company_id, supplier_id, product_id, accessory_id, supplier_ref, manufacturer_ref, ean, designation,
                                       public_price_cents, net_price_cents, discount_rate, discount_family, match_status, match_reason,
                                       tariff_date, price_origin, pack_qty, pack_label)
    values (cid, p_supplier_id,
            case when p_target = 'materiel' then item end, case when p_target = 'accessoires' then item end,
            o->>'supplier_ref', o->>'manufacturer_ref', o->>'ean', o->>'designation',
            -- fichier de prix nets : le prix public connu est conservé
            case when p_price_kind = 'net' and o->>'public_price_cents' is null then (prev->>'public_price_cents')::bigint else (o->>'public_price_cents')::bigint end,
            (o->>'net_price_cents')::bigint, (o->>'discount_rate')::numeric, o->>'discount_family',
            o->>'match_status', o->>'match_reason', p_tariff_date, 'import', coalesce((o->>'pack_qty')::numeric, 1), o->>'pack_label')
    on conflict do nothing
    returning id into oid;
    if oid is null then
      update supplier_offers so set
        supplier_ref       = o->>'supplier_ref',
        manufacturer_ref   = o->>'manufacturer_ref',
        ean                = coalesce(o->>'ean', so.ean),
        designation        = coalesce(o->>'designation', so.designation),
        public_price_cents = case when p_price_kind = 'net' and o->>'public_price_cents' is null then so.public_price_cents else (o->>'public_price_cents')::bigint end,
        net_price_cents    = (o->>'net_price_cents')::bigint,
        discount_rate      = case when o ? 'discount_rate' then (o->>'discount_rate')::numeric else so.discount_rate end,
        discount_family    = coalesce(o->>'discount_family', so.discount_family),
        match_status       = case when so.match_status in ('certain', 'manuel') then so.match_status else o->>'match_status' end,
        tariff_date        = p_tariff_date,
        price_origin       = 'import',
        pack_qty           = coalesce((o->>'pack_qty')::numeric, 1),
        pack_label         = o->>'pack_label',
        updated_at         = now()
      where so.id = (prev->>'id')::uuid
      returning so.id into oid;
      insert into catalog_import_changes (import_id, company_id, table_name, row_id, action, before) values (imp, cid, 'supplier_offers', oid, 'updated', prev);
    else
      insert into catalog_import_changes (import_id, company_id, table_name, row_id, action) values (imp, cid, 'supplier_offers', oid, 'created');
    end if;
    oid := null;
    prev := null;
  end loop;

  if p_target = 'materiel' then
    for r in select * from jsonb_array_elements(p_updates) loop
      insert into catalog_import_changes (import_id, company_id, table_name, row_id, action, before)
      select imp, cid, 'products', p.id, 'updated', to_jsonb(p) from products p where p.id = (r->>'id')::uuid and p.company_id = cid;
      update products set
        range_name           = coalesce(r->>'range_name', range_name),
        cooling_kw           = coalesce((r->>'cooling_kw')::numeric, cooling_kw),
        heating_kw           = coalesce((r->>'heating_kw')::numeric, heating_kw),
        max_outlets          = coalesce((r->>'max_outlets')::smallint, max_outlets),
        link_diameters       = coalesce(r->>'link_diameters', link_diameters),
        precharged_length_m  = coalesce((r->>'precharged_length_m')::numeric, precharged_length_m),
        extra_charge_g_per_m = coalesce((r->>'extra_charge_g_per_m')::integer, extra_charge_g_per_m),
        active               = true
      where id = (r->>'id')::uuid and company_id = cid;
    end loop;
  end if;

  update suppliers set last_price_update_at = now(), tariff_date = greatest(coalesce(tariff_date, p_tariff_date), p_tariff_date) where id = p_supplier_id;
  perform set_config('climdevis.import_id', '', true);
  return imp;
end $$;
revoke all on function public.apply_supplier_import(uuid, text, jsonb, text, text, text, jsonb, jsonb, jsonb, jsonb, date, text) from public, anon;
grant execute on function public.apply_supplier_import(uuid, text, jsonb, text, text, text, jsonb, jsonb, jsonb, jsonb, date, text) to authenticated;

-- Ancienne signature (bloc B) conservée : tarif du jour, prix publics.
create or replace function public.apply_supplier_import(
  p_supplier_id uuid, p_target text, p_mapping jsonb, p_filename text, p_file_hash text, p_source text,
  p_brands jsonb, p_creates jsonb, p_offers jsonb, p_updates jsonb
) returns uuid language sql security invoker set search_path = public as $$
  select public.apply_supplier_import(p_supplier_id, p_target, p_mapping, p_filename, p_file_hash, p_source,
                                      p_brands, p_creates, p_offers, p_updates, current_date, 'public')
$$;

-- -----------------------------------------------------------------------------
-- Annuler le dernier import (non encore annulé) du compte
-- Articles créés : supprimés, ou désactivés s'ils servent déjà dans un devis.
-- -----------------------------------------------------------------------------
create or replace function public.undo_last_catalog_import()
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  cid  uuid := current_company_id();
  imp  catalog_imports;
  c    catalog_import_changes;
  n_restored integer := 0;
  n_deleted  integer := 0;
  n_disabled integer := 0;
begin
  if cid is null then raise exception 'Non authentifié'; end if;
  if not current_is_admin() then raise exception 'Réservé aux administrateurs du compte'; end if;
  select * into imp from catalog_imports where company_id = cid and undone_at is null order by created_at desc limit 1 for update;
  if imp.id is null then raise exception 'Aucun import à annuler'; end if;
  if not exists (select 1 from catalog_import_changes where import_id = imp.id) then raise exception 'Cet import ne peut pas être annulé (fait avant cette fonctionnalité)'; end if;

  for c in select * from catalog_import_changes where import_id = imp.id order by id desc loop
    if c.table_name = 'supplier_offers' then
      if c.action = 'created' then
        delete from supplier_offers where id = c.row_id and company_id = cid;
        n_deleted := n_deleted + 1;
      else
        update supplier_offers so set
          supplier_ref = b.supplier_ref, manufacturer_ref = b.manufacturer_ref, ean = b.ean, designation = b.designation,
          public_price_cents = b.public_price_cents, net_price_cents = b.net_price_cents, discount_rate = b.discount_rate,
          discount_family = b.discount_family, match_status = b.match_status, match_reason = b.match_reason,
          tariff_date = b.tariff_date, price_origin = b.price_origin, pack_qty = b.pack_qty, pack_label = b.pack_label, updated_at = b.updated_at
        from jsonb_populate_record(null::supplier_offers, c.before) b
        where so.id = c.row_id and so.company_id = cid;
        n_restored := n_restored + 1;
      end if;
    elsif c.table_name in ('products', 'accessories') and c.action = 'created' then
      if exists (select 1 from quote_lines where company_id = cid and (product_id = c.row_id or accessory_id = c.row_id))
         or exists (select 1 from quotes where company_id = cid and wizard::text like '%' || c.row_id::text || '%') then
        execute format('update %I set active = false where id = $1 and company_id = $2', c.table_name) using c.row_id, cid;
        n_disabled := n_disabled + 1;
      else
        execute format('delete from %I where id = $1 and company_id = $2', c.table_name) using c.row_id, cid;
        n_deleted := n_deleted + 1;
      end if;
    elsif c.table_name = 'products' then
      update products p set
        range_name = b.range_name, cooling_kw = b.cooling_kw, heating_kw = b.heating_kw, max_outlets = b.max_outlets,
        link_diameters = b.link_diameters, precharged_length_m = b.precharged_length_m, extra_charge_g_per_m = b.extra_charge_g_per_m, active = b.active
      from jsonb_populate_record(null::products, c.before) b
      where p.id = c.row_id and p.company_id = cid;
      n_restored := n_restored + 1;
    elsif c.table_name = 'brands' then
      delete from brands b where b.id = c.row_id and b.company_id = cid and not exists (select 1 from products p where p.brand_id = b.id);
    elsif c.table_name = 'suppliers' then
      update suppliers set column_mapping = c.before->'column_mapping',
                           last_price_update_at = (c.before->>'last_price_update_at')::timestamptz,
                           tariff_date = (c.before->>'tariff_date')::date
      where id = c.row_id and company_id = cid;
    end if;
  end loop;

  delete from price_history where import_id = imp.id;
  update catalog_imports set undone_at = now() where id = imp.id;
  return jsonb_build_object('import_id', imp.id, 'filename', imp.filename, 'restored', n_restored, 'deleted', n_deleted, 'disabled', n_disabled);
end $$;
revoke all on function public.undo_last_catalog_import() from public, anon;
grant execute on function public.undo_last_catalog_import() to authenticated;

-- -----------------------------------------------------------------------------
-- Prix de référence : source et date retenues (tarif importé / saisi à la main)
-- p_products / p_accessories : [{ id, public_price_cents, public_price_source, public_price_date, … }]
-- -----------------------------------------------------------------------------
create or replace function public.apply_reference_prices(p_products jsonb, p_accessories jsonb)
returns void language plpgsql security invoker set search_path = public as $$
declare cid uuid := current_company_id();
begin
  if cid is null then raise exception 'Non authentifié'; end if;
  update products p set
    public_price_cents  = (x->>'public_price_cents')::bigint,
    public_price_source = coalesce(x->>'public_price_source', 'personnel'),
    public_price_date   = (x->>'public_price_date')::date
  from jsonb_array_elements(p_products) x
  where p.id = (x->>'id')::uuid and p.company_id = cid and (x->>'public_price_cents') is not null
    and (p.public_price_cents is distinct from (x->>'public_price_cents')::bigint
         or p.public_price_source is distinct from coalesce(x->>'public_price_source', 'personnel')
         or p.public_price_date is distinct from (x->>'public_price_date')::date)
    and not public.has_published_ref_price(p.ref_product_id);

  update accessories a set
    public_price_cents   = (x->>'public_price_cents')::bigint,
    floor_purchase_cents = (x->>'floor_purchase_cents')::bigint,
    purchase_price_cents = case when (x->>'public_price_cents') is null then (x->>'floor_purchase_cents')::bigint else a.purchase_price_cents end,
    public_price_source  = coalesce(x->>'public_price_source', a.public_price_source),
    public_price_date    = coalesce((x->>'public_price_date')::date, a.public_price_date)
  from jsonb_array_elements(p_accessories) x
  where a.id = (x->>'id')::uuid and a.company_id = cid
    and ((x->>'public_price_cents') is not null or (x->>'floor_purchase_cents') is not null);
end $$;

-- Publication d'un tarif commun : source « commun » et date d'effet sur les produits rattachés
create or replace function public.publish_ref_price_list(p_list_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  l ref_price_lists;
  b ref_brands;
  updated integer := 0;
  companies_updated integer := 0;
  c record;
begin
  if not is_platform_admin() then raise exception 'Réservé à l''éditeur de ClimDevis'; end if;
  select * into l from ref_price_lists where id = p_list_id for update;
  if l.id is null then raise exception 'Tarif inconnu'; end if;
  if l.status <> 'brouillon' then raise exception 'Seul un tarif en brouillon peut être publié'; end if;
  select * into b from ref_brands where id = l.brand_id;

  update ref_price_lists set status = 'archive' where brand_id = l.brand_id and status = 'publie';
  -- le garde-fou (trigger) refuse ici si l'accord écrit manque
  update ref_price_lists set status = 'publie', published_at = now(), published_by = auth.uid() where id = p_list_id;
  update ref_products rp set family = coalesce(p.family, rp.family), updated_at = now()
    from ref_prices p where p.price_list_id = p_list_id and p.ref_product_id = rp.id;

  -- Produits rattachés de tous les comptes : historique, puis nouveau prix public
  insert into price_history (company_id, product_id, old_public_price_cents, new_public_price_cents, ref_price_list_id)
  select pr.company_id, pr.id, pr.public_price_cents, p.public_price_cents, p_list_id
  from products pr join ref_prices p on p.ref_product_id = pr.ref_product_id and p.price_list_id = p_list_id
  where pr.public_price_cents <> p.public_price_cents;
  for c in
    select pr.company_id, count(*) filter (where pr.public_price_cents <> p.public_price_cents) as n
    from products pr join ref_prices p on p.ref_product_id = pr.ref_product_id and p.price_list_id = p_list_id
    group by pr.company_id
  loop
    update products pr set public_price_cents = p.public_price_cents, family = coalesce(p.family, pr.family),
           public_price_source = 'commun', public_price_date = l.effective_date
      from ref_prices p
      where pr.company_id = c.company_id and p.ref_product_id = pr.ref_product_id and p.price_list_id = p_list_id
        and (pr.public_price_cents <> p.public_price_cents or pr.family is distinct from coalesce(p.family, pr.family)
             or pr.public_price_source is distinct from 'commun' or pr.public_price_date is distinct from l.effective_date);
    updated := updated + c.n;
    companies_updated := companies_updated + 1;
    insert into notifications (company_id, kind, title, body, link)
    values (c.company_id, 'tarif_publie',
            format('Nouveau tarif %s publié', b.name),
            format('Tarif %s du %s : %s prix public(s) mis à jour automatiquement. Les devis déjà émis gardent leurs prix.', b.name, to_char(l.effective_date, 'DD/MM/YYYY'), c.n),
            '/app/catalogue');
  end loop;

  -- Comptes qui utilisent la marque sans l'avoir rattachée : « nouveau tarif disponible »
  insert into notifications (company_id, kind, title, body, link)
  select distinct br.company_id, 'tarif_disponible',
         format('Tarif %s disponible', b.name),
         format('Le tarif %s du %s est disponible dans le catalogue commun : rattachez vos produits pour des prix publics toujours à jour.', b.name, to_char(l.effective_date, 'DD/MM/YYYY')),
         '/app/catalogue'
  from brands br
  where (br.ref_brand_id = b.id or lower(br.name) = lower(b.name))
    and not exists (select 1 from products pr join ref_products rp on rp.id = pr.ref_product_id
                    where pr.company_id = br.company_id and rp.brand_id = b.id);

  update ref_price_lists set summary = summary || jsonb_build_object('updated_prices', updated, 'companies', companies_updated) where id = p_list_id;
  return jsonb_build_object('updated_prices', updated, 'companies', companies_updated);
end $$;
revoke all on function public.publish_ref_price_list(uuid) from public, anon;
grant execute on function public.publish_ref_price_list(uuid) to authenticated;
