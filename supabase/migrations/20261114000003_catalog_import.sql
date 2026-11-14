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
