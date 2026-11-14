-- À exécuter après 10_rls_check.sql. Rôles, invitations, lecture seule, offre de lancement.
\set ON_ERROR_STOP 0
insert into auth.users values ('33333333-3333-3333-3333-333333333333', 'Tech@Ex.fr'), ('44444444-4444-4444-4444-444444444444', 'autre@ex.fr');

set role authenticated;
set request.uid = '11111111-1111-1111-1111-111111111111';
select company_can_write() as a_can_write_trial, current_is_admin() as a_is_admin;
insert into invitations (company_id, email, access_role, token) values (current_company_id(), 'tech@ex.fr', 'technicien', 'tok-tech');

-- Mauvais destinataire
set request.uid = '44444444-4444-4444-4444-444444444444';
select accept_invitation('tok-tech');

-- Le technicien rejoint l'entreprise A
set request.uid = '33333333-3333-3333-3333-333333333333';
select company_name, email, access_role, expired, accepted from invitation_preview('tok-tech');
select accept_invitation('tok-tech') = (select id from companies where legal_name = 'Clim A') as joined_a;
select accept_invitation('tok-tech');  -- réutilisation refusée
select count(*) as tech_sees_quotes from quotes;
select count(*) as tech_sees_brands from brands;
insert into brands (company_id, name) values (current_company_id(), 'Pirate');          -- refusé
update companies set legal_name = 'Piratée';                                              -- 0 ligne
update profiles set access_role = 'admin' where id = auth.uid();                          -- refusé
select set_member_role('33333333-3333-3333-3333-333333333333', 'admin');                  -- refusé
insert into clients (company_id, name) values (current_company_id(), 'Client du technicien') returning name as tech_created_client;

-- L'administrateur gère les rôles, sans pouvoir retirer le titulaire
set request.uid = '11111111-1111-1111-1111-111111111111';
select legal_name as a_company_name from companies;
select set_member_role('33333333-3333-3333-3333-333333333333', 'admin') is null as promoted;
select remove_member('11111111-1111-1111-1111-111111111111');                            -- refusé
select email, access_role, role from profiles order by role desc;

-- Fin d'essai : lecture seule pour toute l'équipe
reset role;
update subscriptions set trial_ends_at = now() - interval '1 day' where company_id = (select id from companies where legal_name = 'Clim A');
set role authenticated;
set request.uid = '33333333-3333-3333-3333-333333333333';
select company_can_write() as can_write_after_trial;
insert into clients (company_id, name) values (current_company_id(), 'Trop tard');       -- refusé
update quotes set notes = 'x';                                                            -- 0 ligne
select count(*) as still_reads_quotes from quotes;

-- Offre de lancement (le webhook utilise la clé service)
reset role;
select launch_seats_left() as seats_before;
select claim_launch_seat((select id from companies where legal_name = 'Clim A')) as claimed;
select claim_launch_seat((select id from companies where legal_name = 'Clim A')) as claimed_again_idempotent;
set role anon;
select launch_seats_left() as seats_seen_by_visitor;
select claim_launch_seat('11111111-1111-1111-1111-111111111111');                         -- refusé
reset role;
