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
