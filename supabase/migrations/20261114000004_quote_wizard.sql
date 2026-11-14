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
