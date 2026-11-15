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
