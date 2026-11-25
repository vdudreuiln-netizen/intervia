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
