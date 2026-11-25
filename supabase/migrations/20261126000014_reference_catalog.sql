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
