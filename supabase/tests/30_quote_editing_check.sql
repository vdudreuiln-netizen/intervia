-- À exécuter après 10_rls_check.sql et 20_catalog_import_check.sql
\set ON_ERROR_STOP 1
set role authenticated;
set request.uid = '11111111-1111-1111-1111-111111111111';

-- CERFA : réglementation par défaut
select fluid_form_policy, company_accessory_purchase_coefficient() as accessory_purchase_coefficient from companies;

-- Import avec champs techniques
select apply_catalog_import('materiel', 'Distrib Sud', '{}', 't.xlsx', '[]',
  '[{"brand":"Borée","reference":"BO-71","type":"ue_mono","cooling_kw":7.1,"link_diameters":"3/8 - 5/8","precharged_length_m":15,"extra_charge_g_per_m":40,"public_price_cents":229000}]',
  (select jsonb_build_array(jsonb_build_object('id', id, 'public_price_cents', 99000, 'precharged_length_m', 7.5)) from products where reference = 'BO-35')) is not null as imported;
select reference, link_diameters, precharged_length_m, extra_charge_g_per_m from products where reference in ('BO-35', 'BO-71') order by 1;

-- Accessoire sans prix public (prix d'achat seul), historique
insert into accessories (company_id, category, name, unit, purchase_price_cents) values (current_company_id(), 'autre', 'Carottage', 'u', 2500);
select name, public_price_cents, purchase_price_cents from accessories where name = 'Carottage';
select new_public_price_cents from price_history h join accessories a on a.id = h.accessory_id where a.name = 'Carottage';

-- Remise : kind et value vont ensemble
\set ON_ERROR_STOP 0
insert into accessories (company_id, category, name, unit) values (current_company_id(), 'autre', 'Sans prix', 'u');
update quotes set discount_kind = 'percent' where number = 'D-2026-001';
\set ON_ERROR_STOP 1
update quotes set discount_kind = 'percent', discount_value = 0.05 where number = 'D-2026-001';
select number, discount_kind, discount_value from quotes where number = 'D-2026-001';
reset role;
