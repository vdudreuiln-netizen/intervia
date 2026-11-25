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
