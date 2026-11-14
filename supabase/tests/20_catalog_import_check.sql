-- À exécuter après 10_rls_check.sql (entreprises « Clim A » et « Clim B » créées).
\set ON_ERROR_STOP 1
select id as a_product_id from products p where reference = 'ARC-UE35' and company_id = (select id from companies where legal_name = 'Clim A') \gset
set role authenticated;
set request.uid = '11111111-1111-1111-1111-111111111111';

-- Remise saisie à la main sur un produit exemple
update products set discount_rate = 0.42 where reference = 'ARC-UE35';
select reference, public_price_cents, discount_rate from products where reference in ('ARC-UE35', 'ARC-MU35') order by 1;

-- Import : 1 mise à jour sans remise (doit garder 0,42), 1 avec remise, 1 création, 1 nouvelle marque
select apply_catalog_import(
  'materiel', 'Distrib Sud', '{"reference":"Code article","public_price":"PPI"}', 'tarif-2027.xlsx',
  '[{"name":"Borée","discount_rate":null}]',
  '[{"brand":"Borée","reference":"BO-35","type":"ue_mono","cooling_kw":3.5,"public_price_cents":99000}]',
  (select jsonb_build_array(
     jsonb_build_object('id', (select id from products where reference = 'ARC-UE35'), 'public_price_cents', 117700),
     jsonb_build_object('id', (select id from products where reference = 'ARC-MU35'), 'public_price_cents', 55000, 'discount_rate', 0.3)))
) is not null as imported;

select reference, public_price_cents, discount_rate, (select name from suppliers s where s.id = supplier_id) supplier
from products where reference in ('ARC-UE35', 'ARC-MU35', 'BO-35') order by 1;
select p.reference, h.old_public_price_cents, h.new_public_price_cents, h.old_discount_rate, h.new_discount_rate, h.import_id is not null as from_import
from price_history h join products p on p.id = h.product_id where p.reference = 'ARC-UE35' order by h.changed_at, h.new_public_price_cents;
select name, column_mapping from suppliers;
select target, filename, created_count, updated_count from catalog_imports;

-- B tente de modifier le produit de A via l'import : aucun effet
set request.uid = '22222222-2222-2222-2222-222222222222';
select apply_catalog_import('materiel', 'Pirate', '{}', 'x.csv', '[]', '[]',
  jsonb_build_array(jsonb_build_object('id', :'a_product_id', 'public_price_cents', 1))) is not null as b_import_ran;
select count(*) as b_sees_history_of_a from price_history h where h.import_id is not null and h.new_public_price_cents = 117700;
reset role;
select public_price_cents as a_price_after_b_attack from products where id = :'a_product_id';
