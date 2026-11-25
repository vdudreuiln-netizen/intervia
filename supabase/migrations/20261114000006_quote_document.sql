-- =============================================================================
-- Étape 6 : document du devis — médiateur, acompte, échéancier, rétractation.
-- =============================================================================

-- Médiateur de la consommation (obligatoire pour un client particulier)
alter table companies add column mediator_name text;
alter table companies add column mediator_address text;
alter table companies add column mediator_website text;

-- Acompte par défaut (30 %)
alter table companies add column deposit_rate numeric(4,3) not null default 0.300 check (deposit_rate >= 0 and deposit_rate < 1);

-- Réglages du document, par devis
alter table quotes add column signed_off_premises boolean not null default true;   -- signé chez le client
alter table quotes add column early_start boolean not null default false;          -- démarrage avant la fin des 14 jours
alter table quotes add column urgent_repair boolean not null default false;        -- dépannage urgent demandé par le client
alter table quotes add column deposit_rate numeric(4,3) check (deposit_rate is null or (deposit_rate >= 0 and deposit_rate < 1));
-- échéancier : [{ "label": "À la livraison du matériel", "rate": 0.4 }, …] (la somme fait 100 %)
alter table quotes add column payment_schedule jsonb;
