-- =============================================================================
-- Création de l'entreprise à l'inscription + catalogue exemple
-- =============================================================================

-- Catalogue d'exemple : 4 marques FICTIVES, prix FICTIFS (ordres de grandeur
-- réalistes), clairement marqués « Exemple ». L'artisan peut tout supprimer.
create or replace function public.seed_example_catalog(p_company_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  b record;
  brand_id uuid;
begin
  for b in
    select * from (values
      ('Exemple – Arctica', 0.35::numeric, 1.00::numeric),
      ('Exemple – Boréal',  0.40,          0.92),
      ('Exemple – Cyclone', 0.30,          1.12),
      ('Exemple – Dalia',   0.38,          0.85)
    ) as t(name, discount, price_factor)
  loop
    insert into brands (company_id, name, discount_rate, is_example)
    values (p_company_id, b.name, b.discount, true)
    returning id into brand_id;

    insert into products (company_id, brand_id, range_name, reference, type, cooling_kw, heating_kw, max_outlets, max_indoor_ratio, public_price_cents, is_example)
    select p_company_id, brand_id, p.range_name,
           upper(left(split_part(b.name, '– ', 2), 3)) || '-' || p.ref,
           p.type::product_type, p.cool, p.heat, p.outlets,
           case when p.type = 'ue_multi' then 1.30 end,
           (round(p.price * b.price_factor / 10) * 10 * 100)::bigint,
           true
    from (values
      -- unités extérieures mono-split
      ('Confort',  'UE25',  'ue_mono',     2.5,  3.2, 1, 890),
      ('Confort',  'UE35',  'ue_mono',     3.5,  4.0, 1, 1090),
      ('Confort',  'UE50',  'ue_mono',     5.0,  5.8, 1, 1590),
      ('Confort',  'UE71',  'ue_mono',     7.1,  8.2, 1, 2290),
      -- unités extérieures multi-split
      ('Multi',    'M2-50', 'ue_multi',    5.0,  5.6, 2, 1990),
      ('Multi',    'M3-68', 'ue_multi',    6.8,  8.6, 3, 2790),
      ('Multi',    'M4-80', 'ue_multi',    8.0,  9.4, 4, 3390),
      ('Multi',    'M5-100','ue_multi',   10.0, 12.0, 5, 4290),
      -- unités intérieures murales
      ('Confort',  'MU20',  'ui_murale',   2.0,  2.5, null, 420),
      ('Confort',  'MU25',  'ui_murale',   2.5,  3.2, null, 460),
      ('Confort',  'MU35',  'ui_murale',   3.5,  4.0, null, 540),
      ('Confort',  'MU50',  'ui_murale',   5.0,  5.8, null, 790),
      ('Confort',  'MU71',  'ui_murale',   7.1,  8.2, null, 1090),
      -- consoles
      ('Confort',  'CO25',  'ui_console',  2.5,  3.4, null, 690),
      ('Confort',  'CO35',  'ui_console',  3.5,  4.5, null, 790),
      -- cassettes
      ('Pro',      'CA35',  'ui_cassette', 3.5,  4.0, null, 990),
      ('Pro',      'CA50',  'ui_cassette', 5.0,  6.0, null, 1190),
      -- gainables
      ('Pro',      'GA35',  'ui_gainable', 3.5,  4.0, null, 1190),
      ('Pro',      'GA50',  'ui_gainable', 5.0,  6.0, null, 1390),
      ('Pro',      'GA71',  'ui_gainable', 7.1,  8.0, null, 1790),
      ('Pro',      'GA100', 'ui_gainable',10.0, 11.2, null, 2390)
    ) as p(range_name, ref, type, cool, heat, outlets, price);
  end loop;

  insert into accessories (company_id, category, name, diameter, unit, public_price_cents, discount_rate, is_example)
  values
    (p_company_id, 'liaison',     'Liaison frigorifique isolée',            '1/4 - 3/8', 'm',  1200, 0.30, true),
    (p_company_id, 'liaison',     'Liaison frigorifique isolée',            '1/4 - 1/2', 'm',  1500, 0.30, true),
    (p_company_id, 'liaison',     'Liaison frigorifique isolée',            '3/8 - 5/8', 'm',  2200, 0.30, true),
    (p_company_id, 'goulotte',    'Goulotte de finition 80 × 60',           null,        'm',  1400, 0.25, true),
    (p_company_id, 'goulotte',    'Coude / accessoire de goulotte',         null,        'u',   900, 0.25, true),
    (p_company_id, 'support',     'Support mural unité extérieure',         null,        'u',  4500, 0.25, true),
    (p_company_id, 'support',     'Support sol (silent-blocs) unité extérieure', null,   'u',  6000, 0.25, true),
    (p_company_id, 'pompe',       'Pompe de relevage des condensats',       null,        'u', 12000, 0.25, true),
    (p_company_id, 'condensats',  'Tube d''évacuation des condensats',      '16 mm',     'm',   250, 0.25, true),
    (p_company_id, 'electricite', 'Câble d''alimentation 3G2,5',            null,        'm',   280, 0.25, true),
    (p_company_id, 'electricite', 'Câble de liaison 4G1,5',                 null,        'm',   220, 0.25, true),
    (p_company_id, 'electricite', 'Disjoncteur 16 A courbe D',              null,        'u',  1800, 0.25, true),
    (p_company_id, 'electricite', 'Disjoncteur 20 A courbe D',              null,        'u',  2000, 0.25, true),
    (p_company_id, 'gaz',         'Fluide R32 (complément de charge)',      null,        'kg', 4500, 0.20, true);
end $$;

-- Valeurs par défaut des coefficients (identiques à DEFAULT_SIZING / DEFAULT_LABOR_DAYS).
create or replace function public.default_sizing_coefficients()
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'wattsPerM3',  jsonb_build_object('faible', 45, 'moyenne', 38, 'bonne', 32, 'rt2012', 25),
    'orientation', jsonb_build_object('N', 0.9, 'E', 1.0, 'S', 1.1, 'O', 1.15, 'aucune', 1.0),
    'underRoof', 1.2, 'largeGlazing', 1.15, 'unitMinRatio', 0.95, 'unitMaxRatio', 1.6)
$$;

create or replace function public.default_labor_days()
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'perOutdoorUnit', 0.25,
    'perIndoorUnit', jsonb_build_object('mural', 0.5, 'console', 0.5, 'cassette', 0.75, 'gainable', 1.5),
    'perExtraLinkMeter', 0.02, 'includedLinkMetersPerIndoor', 5, 'commissioning', 0.25, 'roundTo', 0.5)
$$;

-- Appelé une fois par l'utilisateur connecté au début de l'onboarding.
create or replace function public.create_company_for_current_user(p_legal_name text, p_full_name text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  cid uuid;
begin
  if auth.uid() is null then
    raise exception 'Non authentifié';
  end if;
  select company_id into cid from profiles where id = auth.uid();
  if cid is not null then
    return cid; -- idempotent
  end if;

  insert into companies (legal_name, email)
  values (coalesce(nullif(trim(p_legal_name), ''), 'Mon entreprise'), (select email from auth.users where id = auth.uid()))
  returning id into cid;

  insert into profiles (id, company_id, full_name, role) values (auth.uid(), cid, p_full_name, 'owner');
  insert into subscriptions (company_id) values (cid);
  insert into settings_coefficients (company_id, sizing, labor_days)
  values (cid, default_sizing_coefficients(), default_labor_days());
  perform seed_example_catalog(cid);
  return cid;
end $$;

revoke all on function public.create_company_for_current_user(text, text) from public, anon;
grant execute on function public.create_company_for_current_user(text, text) to authenticated;
revoke all on function public.seed_example_catalog(uuid) from public, anon, authenticated;
