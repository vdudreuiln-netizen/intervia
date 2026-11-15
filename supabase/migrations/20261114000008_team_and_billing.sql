-- =============================================================================
-- Étape 8 : équipe (rôles, invitations), abonnement (formules, lancement),
-- lecture seule à la fin de l'essai — garanties EN BASE, pas seulement à l'écran.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Rôles
-- ---------------------------------------------------------------------------
alter table profiles add column access_role text not null default 'admin' check (access_role in ('admin', 'technicien'));
alter table profiles add column email text;
update profiles p set email = u.email from auth.users u where u.id = p.id and p.email is null;

alter table companies add column technicians_see_margins boolean not null default false;

-- Un utilisateur ne modifie que son nom : ni son entreprise, ni son rôle.
drop policy if exists profiles_update_self on profiles;
create policy profiles_update_self on profiles for update using (id = auth.uid()) with check (id = auth.uid());
revoke update on profiles from authenticated;
grant update (full_name) on profiles to authenticated;

create or replace function public.current_is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select access_role = 'admin' from profiles where id = auth.uid()), false)
$$;

-- ---------------------------------------------------------------------------
-- Abonnement
-- ---------------------------------------------------------------------------
alter table subscriptions add column plan text check (plan is null or plan in ('solo', 'equipe', 'entreprise'));
alter table subscriptions add column billing_interval text check (billing_interval is null or billing_interval in ('month', 'year'));
alter table subscriptions add column launch_offer boolean not null default false;
alter table subscriptions add column cancel_at_period_end boolean not null default false;

-- Écriture permise : essai en cours, abonné, ou paiement en échec (délai de grâce).
create or replace function public.company_can_write()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from subscriptions s
    where s.company_id = current_company_id()
      and (s.status in ('active', 'past_due') or (s.status = 'trialing' and s.trial_ends_at > now()))
  )
$$;

-- Offre de lancement : 50 places, jamais rendues (un abonné qui part ne libère pas sa place).
create or replace function public.launch_seats_left()
returns integer language sql stable security definer set search_path = public as $$
  select greatest(0, 50 - (select count(*) from subscriptions where launch_offer)::int)
$$;
grant execute on function public.launch_seats_left() to anon, authenticated;

-- Appelée par le webhook Stripe (clé service) : réserve une place, en série (verrou).
create or replace function public.claim_launch_seat(p_company_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare taken int;
begin
  perform pg_advisory_xact_lock(4242);
  if exists (select 1 from subscriptions where company_id = p_company_id and launch_offer) then return true; end if;
  select count(*) into taken from subscriptions where launch_offer;
  if taken >= 50 then return false; end if;
  update subscriptions set launch_offer = true where company_id = p_company_id;
  return true;
end $$;
revoke all on function public.claim_launch_seat(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Invitations
-- ---------------------------------------------------------------------------
create table invitations (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references companies(id) on delete cascade,
  email        text not null,
  access_role  text not null default 'technicien' check (access_role in ('admin', 'technicien')),
  token        text not null unique default encode(gen_random_bytes(24), 'hex'),
  invited_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default (now() + interval '14 days'),
  accepted_at  timestamptz
);
create unique index invitations_pending_email on invitations (company_id, lower(email)) where accepted_at is null;
alter table invitations enable row level security;
create policy invitations_admin on invitations for all
  using (company_id = current_company_id() and current_is_admin())
  with check (company_id = current_company_id() and current_is_admin());

-- Aperçu d'une invitation (page publique d'acceptation) : entreprise et e-mail invités seulement.
create or replace function public.invitation_preview(p_token text)
returns table (company_name text, email text, access_role text, expired boolean, accepted boolean)
language sql stable security definer set search_path = public as $$
  select c.legal_name, i.email, i.access_role, i.expires_at < now(), i.accepted_at is not null
  from invitations i join companies c on c.id = i.company_id where i.token = p_token
$$;
grant execute on function public.invitation_preview(text) to anon, authenticated;

create or replace function public.accept_invitation(p_token text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  inv invitations;
  user_email text;
begin
  if auth.uid() is null then raise exception 'Non authentifié'; end if;
  select * into inv from invitations where token = p_token for update;
  if inv.id is null then raise exception 'Invitation introuvable'; end if;
  if inv.accepted_at is not null then raise exception 'Invitation déjà utilisée'; end if;
  if inv.expires_at < now() then raise exception 'Invitation expirée'; end if;
  select email into user_email from auth.users where id = auth.uid();
  if lower(user_email) <> lower(inv.email) then raise exception 'Cette invitation est destinée à %', inv.email; end if;
  if exists (select 1 from profiles where id = auth.uid()) then raise exception 'Ce compte est déjà rattaché à une entreprise'; end if;
  insert into profiles (id, company_id, role, access_role, email) values (auth.uid(), inv.company_id, 'member', inv.access_role, user_email);
  update invitations set accepted_at = now() where id = inv.id;
  return inv.company_id;
end $$;
revoke all on function public.accept_invitation(text) from public, anon;
grant execute on function public.accept_invitation(text) to authenticated;

-- Gestion des membres par un administrateur (jamais le titulaire du compte)
create or replace function public.set_member_role(p_user_id uuid, p_role text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not current_is_admin() then raise exception 'Réservé aux administrateurs'; end if;
  if p_role not in ('admin', 'technicien') then raise exception 'Rôle invalide'; end if;
  update profiles set access_role = p_role
  where id = p_user_id and company_id = current_company_id() and role <> 'owner';
  if not found then raise exception 'Membre introuvable (le titulaire du compte reste administrateur)'; end if;
end $$;

create or replace function public.remove_member(p_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not current_is_admin() then raise exception 'Réservé aux administrateurs'; end if;
  delete from profiles where id = p_user_id and company_id = current_company_id() and role <> 'owner' and id <> auth.uid();
  if not found then raise exception 'Membre introuvable (impossible de retirer le titulaire ou soi-même)'; end if;
end $$;
revoke all on function public.set_member_role(uuid, text) from public, anon;
revoke all on function public.remove_member(uuid) from public, anon;
grant execute on function public.set_member_role(uuid, text) to authenticated;
grant execute on function public.remove_member(uuid) to authenticated;

-- Le titulaire est administrateur, avec son e-mail
create or replace function public.create_company_for_current_user(p_legal_name text, p_full_name text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  cid uuid;
  user_email text;
begin
  if auth.uid() is null then raise exception 'Non authentifié'; end if;
  select company_id into cid from profiles where id = auth.uid();
  if cid is not null then return cid; end if;
  select email into user_email from auth.users where id = auth.uid();
  insert into companies (legal_name, email) values (coalesce(nullif(trim(p_legal_name), ''), 'Mon entreprise'), user_email) returning id into cid;
  insert into profiles (id, company_id, full_name, role, access_role, email) values (auth.uid(), cid, p_full_name, 'owner', 'admin', user_email);
  insert into subscriptions (company_id) values (cid);
  insert into settings_coefficients (company_id, sizing, labor_days) values (cid, default_sizing_coefficients(), default_labor_days());
  perform seed_example_catalog(cid);
  perform seed_example_accessories_v2(cid);
  return cid;
end $$;

-- ---------------------------------------------------------------------------
-- RLS : administrateurs pour les paramètres et le catalogue, lecture seule hors abonnement
-- ---------------------------------------------------------------------------
drop policy companies_update on companies;
create policy companies_update on companies for update
  using (id = current_company_id() and current_is_admin())
  with check (id = current_company_id() and current_is_admin());

-- Catalogue et réglages : lecture pour tous les membres, écriture pour les administrateurs
do $$
declare t text;
begin
  foreach t in array array['settings_coefficients', 'brands', 'products', 'accessories', 'suppliers'] loop
    execute format('drop policy %1$s_all on %1$s', t);
    execute format('create policy %1$s_select on %1$s for select using (company_id = current_company_id())', t);
    execute format('create policy %1$s_write on %1$s for all using (company_id = current_company_id() and current_is_admin()) with check (company_id = current_company_id() and current_is_admin())', t);
  end loop;
end $$;
drop policy catalog_imports_insert on catalog_imports;
create policy catalog_imports_insert on catalog_imports for insert with check (company_id = current_company_id() and current_is_admin());

-- Devis, clients, chantiers : tous les membres, mais pas d'écriture en lecture seule
do $$
declare t text;
begin
  foreach t in array array['clients', 'projects', 'rooms', 'quotes', 'quote_lines'] loop
    execute format('drop policy %1$s_all on %1$s', t);
    execute format('create policy %1$s_select on %1$s for select using (company_id = current_company_id())', t);
    execute format('create policy %1$s_insert on %1$s for insert with check (company_id = current_company_id() and company_can_write())', t);
    execute format('create policy %1$s_update on %1$s for update using (company_id = current_company_id() and company_can_write()) with check (company_id = current_company_id() and company_can_write())', t);
    execute format('create policy %1$s_delete on %1$s for delete using (company_id = current_company_id() and company_can_write())', t);
  end loop;
end $$;

-- Logos et tampons : lisibles par tous les membres (PDF), modifiables par les administrateurs
drop policy company_assets_rw on storage.objects;
create policy company_assets_read on storage.objects for select
  using (bucket_id = 'company-assets' and (storage.foldername(name))[1] = current_company_id()::text);
create policy company_assets_write on storage.objects for insert
  with check (bucket_id = 'company-assets' and (storage.foldername(name))[1] = current_company_id()::text and current_is_admin());
create policy company_assets_update on storage.objects for update
  using (bucket_id = 'company-assets' and (storage.foldername(name))[1] = current_company_id()::text and current_is_admin());
create policy company_assets_delete on storage.objects for delete
  using (bucket_id = 'company-assets' and (storage.foldername(name))[1] = current_company_id()::text and current_is_admin());
