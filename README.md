# ClimDevis (nom provisoire)

Chiffrage multi-marques pour artisans climaticiens : un devis climatisation
dimensionné et margé en moins de 10 minutes, sur téléphone.

Stack : Next.js + TypeScript + Tailwind · Supabase (auth, base, stockage) · Stripe · PDF côté serveur.

## Avancement

| Étape | Contenu | État |
|---|---|---|
| 1 | Schéma de base + moteur de calcul + tests | ✅ |
| 2 | Paramètres de l'entreprise (onboarding) + coefficients | ✅ |
| 3 | Catalogue matériel (CSV, remises) | à faire |
| 4 | Assistant projet / devis (6 étapes) | à faire |
| 5 | Panneau « Ma marge » + arrondi | à faire |
| 6 | PDF du devis | à faire |
| 7 | Tableau de bord | à faire |
| 8 | Abonnement Stripe | à faire |

## Organisation

```
supabase/migrations/   schéma, RLS, numérotation D-AAAA-NNN, catalogue exemple
supabase/tests/        vérifications SQL de la RLS (Postgres + stubs Supabase)
src/lib/pricing/       moteur de prix et de marge (UNIQUE endroit où l'on calcule de l'argent)
src/lib/sizing/        dimensionnement W/m³, multi-split, jours de pose, coefficients modifiables
src/lib/company/       paramètres entreprise : validation (SIRET, IBAN, TVA…), conversion formulaire ↔ base
src/lib/geo/           géocodage (Géoplateforme IGN) et détection « même commune »
src/app/               écrans (connexion, onboarding /app/bienvenue, /app/parametres)
```

## Mise en route

1. Créez un projet Supabase, puis exécutez dans l'éditeur SQL les fichiers de `supabase/migrations/` dans l'ordre
   (ou `supabase db push` avec la CLI).
2. Dans Supabase › Authentication › URL Configuration, ajoutez `https://votre-domaine/auth/callback` aux URL de redirection.
3. Copiez `.env.example` en `.env.local` et renseignez les clés.
4. `npm install && npm run dev`, puis ouvrez http://localhost:3000.

L'autocomplétion d'adresse utilise le service public de géocodage de l'IGN
(`data.geopf.fr/geocodage`, successeur de l'API Adresse), gratuit et sans clé.

## Commandes

```bash
npm install
npm test          # tests unitaires (moteur de prix, dimensionnement)
npm run typecheck
```

Vérification de la RLS sur un PostgreSQL local :

```bash
createdb climdevis_test
for f in supabase/tests/00_supabase_stubs.sql supabase/migrations/*.sql supabase/tests/10_rls_check.sql; do
  psql -d climdevis_test -v ON_ERROR_STOP=1 -f "$f"; done
```

## Règles de calcul (résumé)

- Montants en centimes entiers ; TVA calculée par taux sur le total HT du taux.
- Prix d'achat = prix public × (1 − remise) ; la remise produit écrase la remise marque.
- Charges sociales en % du CA HT : taux « matériel » sur matériel + accessoires,
  taux « main d'œuvre » sur MO, déplacement et autres prestations
  (défauts : 12,3 % / 21,2 %, taux micro-entrepreneur 2026).
- Marge nette = CA HT − coût d'achat − charges ; marge/jour = marge nette ÷ jours.
- Alerte « sous le coût » si une ligne ne couvre pas achat + charges qu'elle génère.
- Arrondi psychologique sur le total TTC (…90 € au-dessus de 1 000 €, …49/…99 € en dessous),
  porté par la ligne de main d'œuvre ; seuil inférieur sauf s'il crée une alerte, sinon seuil supérieur.
- Prix de vente du matériel = prix public × coefficient (1,00 par défaut) ; coefficient par marque,
  le coefficient du devis le remplace s'il est renseigné.
- TVA : franchise en base → aucune TVA, mention art. 293 B, totaux HT ; assujetti → 10 % par défaut,
  5,5 / 10 / 20 % ligne par ligne.
- Déplacement : un aller-retour par jour de chantier, max(minimum, km A/R × prix/km).
  Stationnement activable par chantier : par jour max(déplacement + stationnement, minimum journalier).
  Chantier dans la commune : pas de déplacement, seul le stationnement activé est facturé.
- Multi-split : Σ puissances intérieures ≤ 130 % de l'unité extérieure (modifiable par modèle).

> Le dimensionnement W/m³ est un ordre de grandeur pour chiffrer, pas un bilan thermique réglementaire.
