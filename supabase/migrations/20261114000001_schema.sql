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
