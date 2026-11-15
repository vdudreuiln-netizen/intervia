-- =============================================================================
-- Étape 7 : tableau de bord — relances, duplication.
-- =============================================================================

-- Délai avant relance d'un devis envoyé sans réponse (7 jours par défaut)
alter table companies add column follow_up_days smallint not null default 7 check (follow_up_days between 1 and 90);

alter table quotes add column last_follow_up_at timestamptz;
alter table quotes add column follow_up_count smallint not null default 0;

-- Le devis d'origine d'une copie doit appartenir à la même entreprise
create or replace function public.check_duplicated_from()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.duplicated_from is not null and not exists (select 1 from quotes where id = new.duplicated_from and company_id = new.company_id) then
    raise exception 'Devis d''origine inconnu pour cette entreprise';
  end if;
  return new;
end $$;
create trigger quotes_duplicated_from before insert or update of duplicated_from on quotes
  for each row execute function public.check_duplicated_from();

create index if not exists quotes_company_decided on quotes (company_id, decided_at) where status = 'accepte';
