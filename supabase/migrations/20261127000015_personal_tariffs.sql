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

