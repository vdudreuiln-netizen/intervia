-- À exécuter après 100_reference_catalog_check.sql.
-- Attendu : 3 erreurs (fichier de prix nets sur un tarif fabricant, date de tarif manquante,
-- technicien qui annule un import).
\set ON_ERROR_STOP 0
reset role;
select id as ca from companies where legal_name = 'Clim A' \gset
set role authenticated;
set request.uid = '11111111-1111-1111-1111-111111111111';

-- Distributeur + tarif fabricant (prix publics) pour la marque Daikin
insert into suppliers (company_id, name) values (current_company_id(), 'Distri Test');
select id as sd from suppliers where name = 'Distri Test' \gset
select id as bd from brands where company_id = current_company_id() and name = 'Daikin' \gset
insert into suppliers (company_id, name, kind, brand_id) values (current_company_id(), 'Tarif fabricant Daikin', 'fabricant', :'bd');
select id as sf from suppliers where name = 'Tarif fabricant Daikin' \gset

-- 1. Import accessoires (prix publics, couronne de 25 m ramenée au mètre côté serveur)
select apply_supplier_import(:'sd', 'accessoires', '{"reference":"Réf"}'::jsonb, 'tarif.csv', null, 'tableur', '[]'::jsonb,
  '[{"reference":"LIA-1438","category":"liaison","name":"Couronne cuivre","unit":"m","offer":{"manufacturer_ref":"LIA-1438","public_price_cents":850,"net_price_cents":null,"pack_qty":25,"pack_label":"couronne de 25 m"}}]'::jsonb,
  '[]'::jsonb, '[]'::jsonb, '2026-10-01', 'public') is not null as import1;
select id as acc from accessories where reference = 'LIA-1438' \gset
select o.public_price_cents, o.net_price_cents, o.tariff_date, o.pack_qty, o.pack_label, a.public_price_source, a.public_price_date
from supplier_offers o join accessories a on a.id = o.accessory_id where a.id = :'acc';

-- 2. Fichier de prix NETS du même distributeur : prix net importé, prix public conservé
select apply_supplier_import(:'sd', 'accessoires', '{}'::jsonb, 'nets.csv', null, 'tableur', '[]'::jsonb, '[]'::jsonb,
  jsonb_build_array(jsonb_build_object('item_id', :'acc', 'manufacturer_ref', 'LIA-1438', 'public_price_cents', null, 'net_price_cents', 510, 'match_status', 'certain', 'match_reason', 'Référence identique')),
  '[]'::jsonb, '2026-11-01', 'net') is not null as import2;
select public_price_cents, net_price_cents, tariff_date from supplier_offers where accessory_id = :'acc';

-- Refus : prix nets sur un tarif fabricant ; date de tarif manquante
select apply_supplier_import(:'sf', 'materiel', '{}'::jsonb, 'x.csv', null, 'tableur', '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '2026-11-01', 'net');
select apply_supplier_import(:'sd', 'accessoires', '{}'::jsonb, 'x.csv', null, 'tableur', '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, null, 'public');

-- Un technicien ne peut pas annuler
set request.uid = '33333333-3333-3333-3333-333333333333';
select undo_last_catalog_import();

-- 3. Annuler le dernier import (prix nets) : retour au tarif du 01/10
set request.uid = '11111111-1111-1111-1111-111111111111';
select undo_last_catalog_import() - 'import_id' as undo2;
select public_price_cents, net_price_cents, tariff_date from supplier_offers where accessory_id = :'acc';
-- puis le premier : l'accessoire créé disparaît
select undo_last_catalog_import() - 'import_id' as undo1;
select count(*) as accessory_left from accessories where reference = 'LIA-1438';
select filename, undone_at is not null as undone from catalog_imports where filename in ('tarif.csv', 'nets.csv') order by created_at;
reset role;
