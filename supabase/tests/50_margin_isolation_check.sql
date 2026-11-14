-- À exécuter après 40_team_billing_check.sql (technicien 3333 dans Clim A).
\set ON_ERROR_STOP 0
reset role;
-- remettre l'essai en cours et le technicien en technicien
update subscriptions set trial_ends_at = now() + interval '7 days' where company_id = (select id from companies where legal_name = 'Clim A');
update profiles set access_role = 'technicien' where id = '33333333-3333-3333-3333-333333333333';
update companies set technicians_see_margins = false where legal_name = 'Clim A';

set role authenticated;
set request.uid = '33333333-3333-3333-3333-333333333333';
select current_can_see_margins() as tech_sees_margins;
select (select count(*) from products) as products, (select count(*) from brands) as brands, (select count(*) from accessories) as accessories,
       (select count(*) from price_history) as history, (select count(*) from quote_lines) as lines, (select count(*) from quote_financials) as margins;
-- vues sans coûts : prix de vente uniquement
select count(*) as public_products, bool_and(sale_price_cents > 0) as has_sale_price from catalog_products_public;
select reference, sale_price_cents from catalog_products_public where reference = 'ARC-UE35';
select count(*) as public_accessories from catalog_accessories_public;
select column_name from information_schema.columns where table_name in ('catalog_products_public', 'catalog_accessories_public', 'quote_lines_public')
  and column_name ~ '(purchase|discount|margin)';
insert into quote_lines (company_id, quote_id, kind, designation, quantity, unit_sale_cents, unit_purchase_cents)
  select current_company_id(), id, 'other', 'x', 1, 1, 1 from quotes limit 1;   -- refusé
-- l'administrateur autorise les marges
reset role;
update companies set technicians_see_margins = true where legal_name = 'Clim A';
set role authenticated;
set request.uid = '33333333-3333-3333-3333-333333333333';
select current_can_see_margins() as tech_sees_margins_after, (select count(*) > 0 from products) as tech_reads_products;
-- l'autre entreprise ne voit jamais les vues de A
set request.uid = '22222222-2222-2222-2222-222222222222';
select count(*) as b_sees_a_products from catalog_products_public where company_id = (select company_id from profiles where id = '11111111-1111-1111-1111-111111111111');
reset role;

-- Coefficient plancher sur achat : illisible directement, servi seulement si autorisé
reset role;
update companies set technicians_see_margins = false where legal_name = 'Clim A';
set role authenticated;
set request.uid = '33333333-3333-3333-3333-333333333333';
select accessory_purchase_coefficient from companies;                                   -- refusé
select legal_name, company_accessory_purchase_coefficient() as coef_for_tech from companies;
set request.uid = '11111111-1111-1111-1111-111111111111';
select company_accessory_purchase_coefficient() as coef_for_admin;
update companies set accessory_purchase_coefficient = 2.5 returning legal_name;           -- accepté (returning ne lit pas la colonne protégée)
update companies set accessory_purchase_coefficient = 2.5;
select company_accessory_purchase_coefficient() as coef_after_update;
reset role;
