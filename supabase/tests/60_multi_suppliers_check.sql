-- À exécuter après 50_margin_isolation_check.sql (technicien 3333 dans Clim A, sans l'option marges).
-- Attendu : 4 erreurs (lecture/écriture interdites au technicien, quota non appelable, quota dépassé).
\set ON_ERROR_STOP 0
reset role;
update companies set technicians_see_margins = false where legal_name = 'Clim A';

-- Le technicien sans l'option ne voit AUCUN fournisseur, tarif, remise, bon de commande
set role authenticated;
set request.uid = '33333333-3333-3333-3333-333333333333';
select (select count(*) from suppliers) as suppliers, (select count(*) from supplier_offers) as offers,
       (select count(*) from supplier_discounts) as discounts, (select count(*) from purchase_orders) as orders,
       (select count(*) from pdf_tariff_extractions) as pdf_memory;
select column_name from information_schema.columns where table_name = 'quote_lines_public' and column_name like 'supplier%';
insert into supplier_discounts (company_id, supplier_id, family, family_key, rate)
  select current_company_id(), id, 'X', 'X', 0.5 from suppliers limit 1;            -- aucune ligne (fournisseurs invisibles)
update supplier_offers set discount_rate = 0.9;                                      -- aucune ligne
-- Il ne peut pas consommer ni rendre du quota IA lui-même
select consume_ai_quota(current_company_id(), 'tarif_pdf', 1);                       -- refusé
select refund_ai_quota(current_company_id(), 'tarif_pdf', 1000);                     -- refusé
select * from ai_quota_status('tarif_pdf');

-- L'administrateur voit tout
set request.uid = '11111111-1111-1111-1111-111111111111';
select (select count(*) > 0 from suppliers) as admin_suppliers, (select count(*) > 0 from supplier_offers) as admin_offers;
insert into supplier_discounts (company_id, supplier_id, family, family_key, rate)
  select current_company_id(), id, 'Muraux R32', 'MURAUX R32', 0.38 from suppliers where name = 'Distrib Sud';
select family, rate from supplier_discounts where family is not null;
-- Remise invalide
update supplier_discounts set rate = 1 where family is not null;                     -- refusé (contrainte)

-- Quotas : serveur uniquement (service_role)
reset role;
set role service_role;
select consume_ai_quota((select id from companies where legal_name = 'Clim A'), 'tarif_pdf', 250) as remaining_after_250;
select consume_ai_quota((select id from companies where legal_name = 'Clim A'), 'tarif_pdf', 60);   -- refusé : 310 > 300 (essai = Solo)
select refund_ai_quota((select id from companies where legal_name = 'Clim A'), 'tarif_pdf', 50);
select consume_ai_quota((select id from companies where legal_name = 'Clim A'), 'plan', 1) as plans_left;
reset role;
update subscriptions set plan = 'equipe' where company_id = (select id from companies where legal_name = 'Clim A');
set role authenticated;
set request.uid = '11111111-1111-1111-1111-111111111111';
select * from ai_quota_status('tarif_pdf');
select * from ai_quota_status('plan');
-- B ne voit pas la consommation de A
set request.uid = '22222222-2222-2222-2222-222222222222';
select count(*) as b_sees_a_usage from ai_usage;
reset role;
