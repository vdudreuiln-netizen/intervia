\set ON_ERROR_STOP 1
insert into auth.users values ('11111111-1111-1111-1111-111111111111','a@ex.fr'),('22222222-2222-2222-2222-222222222222','b@ex.fr');

set role authenticated;
set request.uid = '11111111-1111-1111-1111-111111111111';
select create_company_for_current_user('Clim A') is not null as a_created;
select create_company_for_current_user('Clim A bis') = (select company_id from profiles) as idempotent;
select count(*) as a_brands, bool_and(is_example) from brands;
select count(*) as a_products from products;
select count(*) as a_accessories from accessories;
select name, reference, public_price_cents from products p join brands b on b.id=p.brand_id where reference like '%UE35' order by 1;
insert into clients (company_id, name) values (current_company_id(), 'Client A') ;
insert into projects (company_id, client_id) select current_company_id(), id from clients;
insert into quotes (company_id, project_id, vat_regime) select current_company_id(), id, 'franchise' from projects;
insert into quotes (company_id, project_id, vat_regime) select current_company_id(), id, 'franchise' from projects;
select number from quotes order by number;

set request.uid = '22222222-2222-2222-2222-222222222222';
select create_company_for_current_user('Clim B') is not null as b_created;
select count(*) as b_sees_clients from clients;
select count(*) as b_sees_quotes from quotes;
select count(*) as b_brands from brands;
insert into clients (company_id, name) values (current_company_id(), 'Client B');
insert into projects (company_id, client_id) select current_company_id(), id from clients;
insert into quotes (company_id, project_id, vat_regime) select current_company_id(), id, 'assujetti' from projects;
select number as b_first_number from quotes;
-- tentatives d'intrusion
\set ON_ERROR_STOP 0
insert into clients (company_id, name) select id, 'pirate' from companies where legal_name = 'Clim A';
update subscriptions set status = 'active';
select count(*) as b_subscription_rows_active from subscriptions where status='active';
update quotes set number = 'D-2026-999';
insert into storage.objects (bucket_id, name) values ('company-assets', '00000000-0000-0000-0000-000000000000/logo.png');
\set ON_ERROR_STOP 1
reset role;
select legal_name, (select count(*) from clients c where c.company_id = companies.id) clients from companies order by 1;
