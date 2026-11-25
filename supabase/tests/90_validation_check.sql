-- À exécuter après 80_site_check.sql.
-- Attendu : 4 erreurs (technicien qui crée un avenant, B qui numérote une fiche chez A,
-- SIRET client invalide, avenant au montant négatif).
\set ON_ERROR_STOP 0
reset role;
select id as qa from quotes where company_id = (select id from companies where legal_name = 'Clim A') limit 1 \gset

set role authenticated;
-- Paramètres du compte pour la fiche fluides : lisibles par les membres
set request.uid = '33333333-3333-3333-3333-333333333333';
select country, leak_detector_id, leak_detector_checked_on from companies;

-- Numéro de fiche unique par compte, stable pour un chantier
select assign_fluid_form_number(:'qa') as n1;
select assign_fluid_form_number(:'qa') as n1_again;
select fluid_form->>'number' as stored from site_jobs where quote_id = :'qa';

-- Avenant : réservé à l'administrateur
insert into quote_amendments (company_id, quote_id, number, total_ht_cents, total_ttc_cents) values (current_company_id(), :'qa', 1, 15600, 17160);   -- refusé

set request.uid = '11111111-1111-1111-1111-111111111111';
insert into quote_amendments (company_id, quote_id, number, total_ht_cents, total_ttc_cents) values (current_company_id(), :'qa', 1, 15600, 17160);
insert into quote_amendments (company_id, quote_id, number, total_ht_cents, total_ttc_cents) values (current_company_id(), :'qa', 2, -1, 0);   -- refusé (montant)
update quote_amendments set status = 'accepte', decided_at = now() where number = 1;
select number, status, total_ht_cents from quote_amendments;
update clients set siret = '123' where company_id = current_company_id();   -- refusé (14 chiffres)
update companies set country = 'BE', leak_detector_id = 'Testo 316-3', leak_detector_checked_on = '2026-03-02' where id = current_company_id();
select country, leak_detector_id from companies;

-- B : ne voit pas les avenants de A, ne peut pas numéroter une fiche chez A
set request.uid = '22222222-2222-2222-2222-222222222222';
select count(*) as b_sees_amendments from quote_amendments;
select assign_fluid_form_number(:'qa');   -- refusé (devis inconnu)
reset role;

-- Les exemples de fixation existent pour chaque entreprise
select c.legal_name, count(a.*) as fixations from companies c left join accessories a on a.company_id = c.id and a.auto_role in ('fixation_chimique', 'fixation_ite', 'support_toiture') group by c.legal_name order by 1;
