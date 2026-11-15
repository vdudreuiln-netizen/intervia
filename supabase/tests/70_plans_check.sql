-- À exécuter après 60_multi_suppliers_check.sql.
-- Attendu : 4 erreurs (technicien qui dépose une fiche technique, B qui écrit chez A,
-- échelle négative, lecture seule qui écrit un plan).
\set ON_ERROR_STOP 0
reset role;
update subscriptions set trial_ends_at = now() + interval '7 days' where company_id = (select id from companies where legal_name = 'Clim A');
select id as qa from quotes where company_id = (select id from companies where legal_name = 'Clim A') limit 1 \gset
select company_id as ca from profiles where id = '11111111-1111-1111-1111-111111111111' \gset

set role authenticated;
-- Le technicien (sans l'option marges) crée le plan du devis et le voit
set request.uid = '33333333-3333-3333-3333-333333333333';
insert into quote_plans (company_id, quote_id, level, image_path, width_px, height_px) values (current_company_id(), :'qa', 0, :'ca' || '/' || :'qa' || '/rdc.jpg', 1600, 1200);
select level, width_px, layout from quote_plans;
insert into storage.objects (bucket_id, name) values ('plans', :'ca' || '/' || :'qa' || '/rdc.jpg');
-- …mais ne dépose pas de fiche technique (administrateurs seulement)
insert into storage.objects (bucket_id, name) values ('datasheets', :'ca' || '/fiche.pdf');          -- refusé
update quote_plans set scale_m_per_px = -1;                                                           -- refusé (contrainte)
update quote_plans set scale_m_per_px = 0.01, scale_source = 'mesure', north_deg = 90;
select scale_source, north_deg from quote_plans;

-- L'administrateur dépose la fiche technique
set request.uid = '11111111-1111-1111-1111-111111111111';
insert into storage.objects (bucket_id, name) values ('datasheets', :'ca' || '/fiche.pdf');
update products set datasheet_path = :'ca' || '/fiche.pdf', datasheet_name = 'Fiche ARC-UE35.pdf' where reference = 'ARC-UE35' and company_id = current_company_id();
select reference, datasheet_name from catalog_products_public where datasheet_path is not null;

-- B ne voit ni ne modifie le plan de A, ni ses fichiers
set request.uid = '22222222-2222-2222-2222-222222222222';
select count(*) as b_sees_plans from quote_plans;
select count(*) as b_sees_files from storage.objects where bucket_id in ('plans', 'datasheets');
insert into quote_plans (company_id, quote_id, level, image_path, width_px, height_px) values (current_company_id(), :'qa', 1, 'x', 100, 100);  -- refusé

-- Lecture seule (essai terminé) : plus d'écriture de plan
reset role;
update subscriptions set trial_ends_at = now() - interval '1 day', status = 'trialing' where company_id = :'ca';
set role authenticated;
set request.uid = '11111111-1111-1111-1111-111111111111';
insert into quote_plans (company_id, quote_id, level, image_path, width_px, height_px) values (current_company_id(), :'qa', 2, 'x', 100, 100);  -- refusé
select count(*) as plans_after_read_only from quote_plans;
reset role;
update subscriptions set trial_ends_at = now() + interval '7 days' where company_id = :'ca';
