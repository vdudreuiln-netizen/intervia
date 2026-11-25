-- À exécuter après 90_validation_check.sql.
-- Attendu : 6 erreurs :
--   artisan qui écrit dans le catalogue commun, publication sans accord (trigger),
--   « accord obtenu » sans justificatif, publication par un non-éditeur,
--   signalement au nom d'un autre compte, modification du titre d'une notification.
\set ON_ERROR_STOP 0
reset role;
insert into auth.users values ('99999999-9999-9999-9999-999999999999', 'editeur@ex.fr') on conflict do nothing;
insert into platform_admins (user_id) values ('99999999-9999-9999-9999-999999999999');
select id as ca from companies where legal_name = 'Clim A' \gset
-- Clim A a un produit Daikin : on le rattachera au catalogue commun
insert into brands (company_id, name) select :'ca', 'Daikin' where not exists (select 1 from brands where company_id = :'ca' and name = 'Daikin');
select id as brand_a from brands where company_id = :'ca' and name = 'Daikin' \gset
insert into products (company_id, brand_id, reference, type, public_price_cents) values (:'ca', :'brand_a', 'RXM35R', 'ue_mono', 100000);
-- Clim B utilise aussi Daikin, sans rien rattacher
insert into brands (company_id, name) select id, 'Daikin' from companies where legal_name = 'Clim B';
select id as prod_a from products where company_id = :'ca' and reference = 'RXM35R' \gset

set role authenticated;
-- L'éditeur crée la marque (sans accord), le produit et un tarif en brouillon
set request.uid = '99999999-9999-9999-9999-999999999999';
insert into ref_brands (name, agreement_status) values ('Daikin', 'demande');
select id as rb from ref_brands where name = 'Daikin' \gset
insert into ref_products (brand_id, manufacturer_ref, type, family) values (:'rb', 'RXM35R', 'ue_mono', 'Split mural');
select id as rp from ref_products where manufacturer_ref = 'RXM35R' \gset
insert into ref_price_lists (brand_id, effective_date, source_label) values (:'rb', '2027-01-01', 'Tarif public Daikin 2027');
select id as rl from ref_price_lists where brand_id = :'rb' \gset
insert into ref_prices (price_list_id, ref_product_id, public_price_cents, family) values (:'rl', :'rp', 104000, 'Split mural');

-- Un artisan ne voit pas une marque sans accord et ne peut rien écrire
set request.uid = '11111111-1111-1111-1111-111111111111';
select count(*) as artisan_sees_brand_without_agreement from ref_brands;
insert into ref_brands (name) values ('Pirate');   -- refusé (catalogue commun : éditeur seulement)

-- Publication sans accord écrit : refusée par la base
set request.uid = '99999999-9999-9999-9999-999999999999';
select publish_ref_price_list(:'rl');   -- refusé (accord non obtenu)
update ref_brands set agreement_status = 'obtenu', agreement_date = '2026-12-15' where id = :'rb';   -- refusé (justificatif manquant)
update ref_brands set agreement_status = 'obtenu', agreement_date = '2026-12-15', agreement_proof_path = 'daikin/accord-2026-12-15.pdf' where id = :'rb';

-- L'artisan rattache son produit, puis l'éditeur publie
reset role;
update products set ref_product_id = :'rp' where id = :'prod_a';
set role authenticated;
set request.uid = '22222222-2222-2222-2222-222222222222';
select publish_ref_price_list(:'rl');   -- refusé (pas éditeur)
set request.uid = '99999999-9999-9999-9999-999999999999';
select publish_ref_price_list(:'rl') as publication;

-- Prix public mis à jour automatiquement, historique tracé, notification envoyée
set request.uid = '11111111-1111-1111-1111-111111111111';
select public_price_cents, family from products where id = :'prod_a';
select old_public_price_cents, new_public_price_cents, ref_price_list_id is not null as from_ref_tariff from price_history where product_id = :'prod_a' order by changed_at desc limit 1;
select kind, title from notifications order by created_at;
update notifications set read_at = now() where read_at is null;
update notifications set title = 'x';   -- refusé (seule la colonne « lu » est modifiable)
select count(*) as artisan_sees_brand_with_agreement from ref_brands;
select count(*) as artisan_sees_prices from ref_prices;

-- Clim B (marque Daikin non rattachée) : « tarif disponible » ; ne voit pas les signalements de A
set request.uid = '11111111-1111-1111-1111-111111111111';
insert into missing_product_reports (company_id, brand_name, manufacturer_ref) values (current_company_id(), 'Toshiba', 'RAS-B10');
insert into missing_product_reports (company_id, brand_name) values ((select id from companies where legal_name = 'Clim B'), 'Pirate');   -- refusé
set request.uid = '22222222-2222-2222-2222-222222222222';
select count(*) as b_sees_a_reports from missing_product_reports;
select kind from notifications;
set request.uid = '99999999-9999-9999-9999-999999999999';
select brand_name, status from missing_product_reports;
reset role;
select status from ref_price_lists where id = :'rl';

-- Un recalcul depuis les tarifs distributeurs ne remplace pas le prix fabricant publié
set role authenticated;
set request.uid = '11111111-1111-1111-1111-111111111111';
select apply_reference_prices(jsonb_build_array(jsonb_build_object('id', :'prod_a', 'public_price_cents', 99000)), '[]'::jsonb);
select public_price_cents as still_manufacturer_price from products where id = :'prod_a';
reset role;
