-- =============================================================================
-- Cloisonnement des marges EN BASE : un technicien sans l'option « voir les
-- marges » ne peut lire AUCUN prix d'achat, remise ou marge, même via l'API.
--
-- Tables concernées (lecture réservée aux membres autorisés) :
--   brands (remise), products (remise), accessories (remise, prix d'achat),
--   price_history, suppliers, catalog_imports, quote_lines (prix d'achat),
--   quote_financials (marge nette du devis, sortie de la table quotes).
-- Les calculs qui ont besoin des coûts sont faits côté serveur (clé service,
-- filtrée par entreprise) et seuls des résultats nettoyés partent au navigateur.
-- =============================================================================

create or replace function public.current_can_see_margins()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select p.access_role = 'admin' or c.technicians_see_margins
    from profiles p join companies c on c.id = p.company_id
    where p.id = auth.uid()
  ), false)
$$;

-- Marge nette des devis : table dédiée (la table quotes reste lisible par tous les membres)
create table quote_financials (
  quote_id         uuid primary key references quotes(id) on delete cascade,
  company_id       uuid not null references companies(id) on delete cascade,
  net_margin_cents bigint not null default 0,
  updated_at       timestamptz not null default now()
);
insert into quote_financials (quote_id, company_id, net_margin_cents)
select id, company_id, net_margin_cents from quotes;
alter table quotes drop column net_margin_cents;

alter table quote_financials enable row level security;
create policy quote_financials_select on quote_financials for select
  using (company_id = current_company_id() and current_can_see_margins());
create policy quote_financials_write on quote_financials for all
  using (company_id = current_company_id() and current_can_see_margins() and company_can_write())
  with check (company_id = current_company_id() and current_can_see_margins() and company_can_write());

-- Lecture des tables de coûts : membres autorisés seulement
do $$
declare t text;
begin
  foreach t in array array['brands', 'products', 'accessories', 'suppliers'] loop
    execute format('drop policy %1$s_select on %1$s', t);
    execute format('create policy %1$s_select on %1$s for select using (company_id = current_company_id() and current_can_see_margins())', t);
  end loop;
end $$;

drop policy price_history_select on price_history;
create policy price_history_select on price_history for select using (company_id = current_company_id() and current_can_see_margins());
drop policy catalog_imports_select on catalog_imports;
create policy catalog_imports_select on catalog_imports for select using (company_id = current_company_id() and current_can_see_margins());

-- Lignes de devis : lecture, modification et suppression réservées aux membres autorisés.
-- (Pour un technicien sans l'option, le serveur lit et écrit les lignes pour lui,
-- après contrôle de l'entreprise et des droits, et ne lui renvoie que les prix de vente.)
drop policy quote_lines_select on quote_lines;
drop policy quote_lines_insert on quote_lines;
drop policy quote_lines_update on quote_lines;
drop policy quote_lines_delete on quote_lines;
create policy quote_lines_select on quote_lines for select
  using (company_id = current_company_id() and current_can_see_margins());
create policy quote_lines_insert on quote_lines for insert
  with check (company_id = current_company_id() and current_can_see_margins() and company_can_write());
create policy quote_lines_update on quote_lines for update
  using (company_id = current_company_id() and current_can_see_margins() and company_can_write())
  with check (company_id = current_company_id() and current_can_see_margins() and company_can_write());
create policy quote_lines_delete on quote_lines for delete
  using (company_id = current_company_id() and current_can_see_margins() and company_can_write());

-- Vues sans coûts, utilisables par tous les membres (prix de vente uniquement).
-- Vues « definer » : elles filtrent elles-mêmes sur l'entreprise de l'utilisateur.
create view quote_lines_public with (security_barrier) as
  select id, company_id, quote_id, position, kind, origin, wizard_key, product_id, accessory_id, room_id,
         designation, quantity, unit, unit_sale_cents, vat_rate
  from quote_lines where company_id = current_company_id();

create view catalog_products_public with (security_barrier) as
  select p.id, p.company_id, p.brand_id, b.name as brand_name, p.range_name, p.reference, p.type,
         p.cooling_kw, p.heating_kw, p.max_outlets, p.max_indoor_ratio, p.link_diameters,
         p.precharged_length_m, p.extra_charge_g_per_m, p.is_example, p.active,
         round(p.public_price_cents * b.sale_coefficient)::bigint as sale_price_cents
  from products p join brands b on b.id = p.brand_id
  where p.company_id = current_company_id();

create view catalog_accessories_public with (security_barrier) as
  select a.id, a.company_id, a.reference, a.category, a.name, a.diameter, a.unit, a.auto_role, a.is_example, a.active,
         case
           when a.public_price_cents is null then round(coalesce(a.purchase_price_cents, 0) * c.accessory_purchase_coefficient)::bigint
           else greatest(round(a.public_price_cents * c.accessory_sale_coefficient),
                         round(round(a.public_price_cents * (1 - a.discount_rate)) * c.accessory_purchase_coefficient))::bigint
         end as sale_price_cents
  from accessories a join companies c on c.id = a.company_id
  where a.company_id = current_company_id();

revoke all on quote_lines_public, catalog_products_public, catalog_accessories_public from anon;
grant select on quote_lines_public, catalog_products_public, catalog_accessories_public to authenticated;

-- ATTENTION pour les migrations futures : toute nouvelle colonne de `companies` doit être
-- ajoutée explicitement par « grant select (colonne) on companies to authenticated ».
--
-- Le coefficient plancher sur achat des accessoires permettrait de retrouver un prix
-- d'achat (vente ÷ coefficient) : colonne illisible via l'API, servie seulement aux
-- membres autorisés par une fonction.
do $$
declare cols text;
begin
  select string_agg(quote_ident(column_name), ', ') into cols
  from information_schema.columns
  where table_schema = 'public' and table_name = 'companies' and column_name <> 'accessory_purchase_coefficient';
  execute 'revoke select on public.companies from authenticated, anon';
  execute format('grant select (%s) on public.companies to authenticated', cols);
end $$;

create or replace function public.company_accessory_purchase_coefficient()
returns numeric language sql stable security definer set search_path = public as $$
  select case when current_can_see_margins() then accessory_purchase_coefficient end
  from companies where id = current_company_id()
$$;
grant execute on function public.company_accessory_purchase_coefficient() to authenticated;
