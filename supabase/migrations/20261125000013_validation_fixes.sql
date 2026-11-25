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
