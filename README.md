# ClimDevis (nom provisoire)

Chiffrage multi-marques pour artisans climaticiens : un devis climatisation
dimensionné et margé en moins de 10 minutes, sur téléphone.

Stack : Next.js + TypeScript + Tailwind · Supabase (auth, base, stockage) · Stripe · PDF côté serveur.

## Avancement

| Étape | Contenu | État |
|---|---|---|
| 1 | Schéma de base + moteur de calcul + tests | ✅ |
| 2 | Paramètres de l'entreprise (onboarding) | à faire |
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
src/lib/sizing/        dimensionnement W/m³ et jours de main d'œuvre proposés
```

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
- Déplacement : max(forfait minimum, km aller-retour × prix/km) par aller-retour, + stationnement/jour ;
  aucun frais si le chantier est dans la commune de l'artisan.

> Le dimensionnement W/m³ est un ordre de grandeur pour chiffrer, pas un bilan thermique réglementaire.
