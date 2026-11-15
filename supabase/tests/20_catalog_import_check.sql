-- À exécuter après 10_rls_check.sql (entreprises « Clim A » et « Clim B » créées).
\set ON_ERROR_STOP 1
select id as a_product_id from products p where reference = 'ARC-UE35' and company_id = (select id from companies where legal_name = 'Clim A') \gset
set role authenticated;
set request.uid = '11111111-1111-1111-1111-111111111111';

-- Le catalogue exemple a été repris chez « Fournisseur principal »
select s.name, count(o.*) as offers from suppliers s join supplier_offers o on o.supplier_id = s.id group by s.name;

-- Nouveau fournisseur, remise manuelle sur une offre existante
insert into suppliers (company_id, name, shipping_fee_cents, franco_cents) values (current_company_id(), 'Distrib Sud', 2500, 50000);
select id as sud from suppliers where name = 'Distrib Sud' \gset
insert into supplier_offers (company_id, supplier_id, product_id, manufacturer_ref, public_price_cents, discount_rate, match_status)
values (current_company_id(), :'sud', :'a_product_id', 'ARC-UE35', 110000, 0.42, 'manuel');

-- Import : 1 offre existante sans remise (doit garder 0,42), 1 offre avec remise, 1 probable, 1 création, 1 nouvelle marque
select apply_supplier_import(
  :'sud', 'materiel', '{"reference":"Code article","public_price":"PPI"}', 'tarif-2027.xlsx', 'abc123', 'tableur',
  '[{"name":"Borée"}]',
  '[{"brand":"Borée","reference":"BO-35","type":"ue_mono","cooling_kw":3.5,"offer":{"supplier_ref":"S-1","manufacturer_ref":"BO-35","public_price_cents":99000}}]',
  (select jsonb_build_array(
     jsonb_build_object('item_id', :'a_product_id', 'match_status', 'certain', 'supplier_ref', 'S-2', 'manufacturer_ref', 'ARC-UE35', 'public_price_cents', 117700),
     jsonb_build_object('item_id', (select id from products where reference = 'ARC-MU35' and company_id = current_company_id()), 'match_status', 'certain', 'manufacturer_ref', 'ARC-MU35', 'public_price_cents', 55000, 'discount_rate', 0.3),
     jsonb_build_object('item_id', (select id from products where reference = 'ARC-MU25' and company_id = current_company_id()), 'match_status', 'probable', 'manufacturer_ref', 'ARC-MU25X', 'public_price_cents', 45000))),
  '[]'
) is not null as imported;

select p.reference, o.public_price_cents, o.discount_rate, o.match_status, o.supplier_ref
from supplier_offers o join products p on p.id = o.product_id where o.supplier_id = :'sud' order by 1;
select h.old_public_price_cents, h.new_public_price_cents, h.new_discount_rate, h.import_id is not null as from_import
from price_history h where h.supplier_id = :'sud' and h.product_id = :'a_product_id' order by h.changed_at, h.new_public_price_cents;
select name, column_mapping, last_price_update_at is not null as dated from suppliers where id = :'sud';
select target, filename, file_hash, created_count, updated_count from catalog_imports;

-- Prix de référence recalculés par le serveur
select apply_reference_prices(jsonb_build_array(jsonb_build_object('id', :'a_product_id', 'public_price_cents', 117700)), '[]');
select public_price_cents as reference_price from products where id = :'a_product_id';

-- B tente d'importer chez un fournisseur de A, puis vers un produit de A : refusé
set request.uid = '22222222-2222-2222-2222-222222222222';
\set ON_ERROR_STOP 0
select apply_supplier_import(:'sud', 'materiel', '{}', 'x.csv', null, 'tableur', '[]', '[]', '[]', '[]');
insert into suppliers (company_id, name) values (current_company_id(), 'Pirate');
select apply_supplier_import((select id from suppliers where name = 'Pirate'), 'materiel', '{}', 'x.csv', null, 'tableur', '[]', '[]',
  jsonb_build_array(jsonb_build_object('item_id', :'a_product_id', 'match_status', 'certain', 'public_price_cents', 1)), '[]');
select apply_reference_prices(jsonb_build_array(jsonb_build_object('id', :'a_product_id', 'public_price_cents', 1)), '[]');
\set ON_ERROR_STOP 1
select count(*) as b_sees_offers_of_a from supplier_offers where supplier_id = :'sud';
reset role;
select public_price_cents as a_price_after_b_attack from products where id = :'a_product_id';
