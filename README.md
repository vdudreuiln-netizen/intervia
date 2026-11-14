# ClimDevis (nom provisoire)

Chiffrage multi-marques pour artisans climaticiens : un devis climatisation
dimensionné et margé en moins de 10 minutes, sur téléphone.

Stack : Next.js + TypeScript + Tailwind · Supabase (auth, base, stockage) · Stripe · PDF côté serveur.

## Avancement

| Étape | Contenu | État |
|---|---|---|
| 1 | Schéma de base + moteur de calcul + tests | ✅ |
| 2 | Paramètres de l'entreprise (onboarding) + coefficients | ✅ |
| 3 | Catalogue : import Excel/CSV, remises, coefficients, historique des prix | ✅ |
| 4 | Assistant devis : client, pièces, puissances, solutions Éco/Confort/Premium, métré, main d'œuvre | ✅ |
| 5 | Éditeur de devis : retouches, lignes libres, remise, panneau « Ma marge », arrondi | ✅ |
| 6 | PDF du devis : modes particulier / détaillé, mentions légales, acompte, rétractation, partage | ✅ |
| 7 | Tableau de bord | à faire |
| 8 | Abonnement Stripe | à faire |

## Organisation

```
supabase/migrations/   schéma, RLS, numérotation D-AAAA-NNN, catalogue exemple
supabase/tests/        vérifications SQL de la RLS (Postgres + stubs Supabase)
src/lib/pricing/       moteur de prix et de marge (UNIQUE endroit où l'on calcule de l'argent)
src/lib/sizing/        dimensionnement W/m³, multi-split, jours de pose, coefficients modifiables
src/lib/company/       paramètres entreprise : validation (SIRET, IBAN, TVA…), conversion formulaire ↔ base
src/lib/catalog/       import de tarifs (CSV, xlsx), plan d'import, formulaires du catalogue
src/lib/geo/           géocodage et distance routière (Géoplateforme IGN), détection « même commune »
src/lib/quote/         assistant devis : choix du matériel, options, lignes, métré (pur, testé)
src/lib/pdf/           modèle du devis imprimé (pur, testé) et rendu PDF (@react-pdf/renderer)
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

Vérification de la RLS et de l'import sur un PostgreSQL local :

```bash
createdb climdevis_test
for f in supabase/tests/00_supabase_stubs.sql supabase/migrations/*.sql supabase/tests/10_rls_check.sql supabase/tests/20_catalog_import_check.sql supabase/tests/30_quote_editing_check.sql; do
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
- Accessoires : prix de vente = le plus élevé de (prix public × coefficient accessoires, 1,30 par défaut,
  modifiable par devis) et (prix d'achat × coefficient sur achat, 2,00). Sans prix public : achat × 2,00.
- Remise commerciale (€ HT ou %) répartie au prorata des lignes : TVA par taux, charges et alertes
  recalculées ; remise maximale avant alerte calculée par dichotomie.
- Arrondi : s'il y a une remise, c'est elle qui absorbe l'écart ; sinon la main d'œuvre (forfait).
- Retouches (prix, TVA, suppressions, lignes libres) conservées si l'on relance l'assistant
  (au choix : conserver ou tout recalculer).
- Import de tarif : mise à jour par marque + référence (sans doublon), remise conservée si le fichier
  n'en contient pas, historique daté de chaque changement de prix (trigger SQL), import tout-ou-rien.
- Solutions : mono / multi / gainable, une seule marque par option. Éco = prix client le plus bas,
  Confort = meilleure marge nette (parmi les options sans alerte quand il y en a), Premium = marque
  préférée ; options identiques fusionnées. Multi au-delà des sorties : 2 UE (avertissement).
  Gainable si combles accessibles ; 2 gainables si 2 niveaux ou puissance > plus grosse gainable.
- Lignes générées par unité (toutes décochables) : liaison au diamètre de la fiche produit (sinon règle
  ≤ 3,5 kW 1/4-3/8, ≤ 5 kW 1/4-1/2, au-delà 3/8-5/8), goulotte, condensats, câble de liaison, pompe
  (option), support mural OU sol, ligne électrique, disjoncteur, complément de charge au-delà de la
  longueur pré-chargée (arrondi au 0,1 kg), mise en service, fiche CERFA 15497*04 (si complément ou
  à chaque mise en service, par défaut — réglementation — ou seulement si complément), réseau aéraulique et zonage pour le gainable.
- Les lignes du devis sont recalculées côté serveur à partir du catalogue en base.
- Multi-split : Σ puissances intérieures ≤ 130 % de l'unité extérieure (modifiable par modèle).

## Devis imprimé (PDF)

- Généré côté serveur à chaque ouverture (`/app/devis/[id]/pdf`) : il reflète toujours les dernières retouches.
- Aucune donnée de marge, de coût d'achat ni de charges dans le modèle du document (vérifié par un test).
- « Client particulier » : Fourniture (matériel + accessoires, détail sans prix), Main d'œuvre, Mise en
  service et contrôle d'étanchéité (avec la fiche fluides), prestations libres, Déplacement, Remise commerciale.
- Mentions : devis gratuit et validité, décennale (assureur, contrat, zone), médiateur de la consommation,
  TVA ou art. 293 B, RIB en pied de page, « Bon pour accord. Devis reçu avant l'exécution des travaux ».
- Signé chez le client : information 14 jours + formulaire de rétractation détachable ; acompte payable
  7 jours après la signature (art. L221-10). Option démarrage anticipé (L221-25) et dépannage urgent (L221-28 8°).
- Médiateur, SIRET ou décennale manquant : bandeau rouge sur le PDF et passage en « Envoyé » bloqué.

> Le dimensionnement W/m³ est un ordre de grandeur pour chiffrer, pas un bilan thermique réglementaire.
