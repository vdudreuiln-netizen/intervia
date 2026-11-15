-- À exécuter après 70_plans_check.sql.
-- Attendu : 4 erreurs (technicien qui décide d'un écart, B qui écrit chez A,
-- écart créé au nom d'un autre, quantité négative).
\set ON_ERROR_STOP 0
reset role;
update subscriptions set trial_ends_at = now() + interval '7 days' where company_id = (select id from companies where legal_name = 'Clim A');
update companies set technicians_see_margins = false where legal_name = 'Clim A';
select id as qa from quotes where company_id = (select id from companies where legal_name = 'Clim A') limit 1 \gset

set role authenticated;
-- Réglages : colonnes lisibles par les membres
set request.uid = '33333333-3333-3333-3333-333333333333';
select placement_rules, fluid_capacity_number from companies;

-- Le technicien démarre le chantier, coche, photographie, signale un écart
insert into site_jobs (company_id, quote_id, status, checks) values (current_company_id(), :'qa', 'en_cours', '{"ui:1": {"at": "2026-11-17"}}');
insert into site_photos (company_id, quote_id, path, element_id, kind) values (current_company_id(), :'qa', current_company_id() || '/' || :'qa' || '/p1.jpg', 'ui:1', 'etiquette');
insert into site_deviations (company_id, quote_id, kind, quantity, description, created_by) values (current_company_id(), :'qa', 'longueur', 2, 'Liaison 2 m plus longue', '33333333-3333-3333-3333-333333333333');
insert into site_deviations (company_id, quote_id, kind, quantity, description, created_by) values (current_company_id(), :'qa', 'longueur', -1, 'x', '33333333-3333-3333-3333-333333333333');   -- refusé (quantité)
insert into site_deviations (company_id, quote_id, kind, description, created_by) values (current_company_id(), :'qa', 'autre', 'au nom d''un autre', '11111111-1111-1111-1111-111111111111');  -- refusé
update site_deviations set status = 'accepte';            -- aucune ligne : décision réservée aux administrateurs
select status, kind from site_deviations;
select count(*) as tech_sees_costs from site_deviation_costs;

-- L'administrateur décide et voit le surcoût
set request.uid = '11111111-1111-1111-1111-111111111111';
insert into site_deviation_costs (deviation_id, company_id, extra_purchase_cents, extra_sale_cents) select id, company_id, 2400, 3600 from site_deviations;
update site_deviations set status = 'avenant_envoye', amendment_number = 1;
select status, amendment_number from site_deviations;
select extra_purchase_cents, extra_sale_cents from site_deviation_costs;

-- B ne voit rien et n'écrit pas chez A
set request.uid = '22222222-2222-2222-2222-222222222222';
select (select count(*) from site_jobs) as jobs, (select count(*) from site_photos) as photos, (select count(*) from site_deviations) as deviations;
insert into site_jobs (company_id, quote_id) values (current_company_id(), :'qa');   -- refusé (devis d'une autre entreprise)
insert into storage.objects (bucket_id, name) values ('chantier', (select company_id from quotes where id = :'qa')::text || '/x.jpg');   -- refusé
reset role;
