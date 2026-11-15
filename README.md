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
| 7 | Tableau de bord : CA HT signé, marge, transformation, relances, duplication | ✅ |
| 8 | Abonnement Stripe (3 formules + offre de lancement), équipe et rôles, lecture seule | ✅ |
| A | Plans : import (PDF, photo, croquis, plan d'agence) et lecture par l'IA, validation des pièces, implantation → métré, annexes PDF, dossier chantier, fiches techniques | ✅ |
| B | Multi-fournisseurs : tarifs par fournisseur (Excel/CSV/PDF par l'IA), remises marque › famille › référence, rapprochement des références, choix du moins cher port compris, comparatif, bons de commande, alerte tarif ancien | ✅ |

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
src/lib/billing/       formules, accès (essai / lecture seule), synchronisation Stripe
src/lib/dashboard/     indicateurs du mois (heure de Paris), relances, message type
src/lib/pdf/           modèle du devis imprimé (pur, testé) et rendu PDF (@react-pdf/renderer)
src/lib/security/      accès aux données de coûts (cloisonnement des marges)
src/lib/legal/         informations de l'éditeur pour les pages légales (À COMPLÉTER)
src/lib/demo/          devis de démonstration créé à l'inscription
supabase/emails-fr.md  modèles d'e-mails Supabase en français
src/app/               écrans (connexion, onboarding /app/bienvenue, /app/parametres)
```

## Mise en route

**Guide pas à pas pour non-développeur : [MISE-EN-LIGNE.md](MISE-EN-LIGNE.md).**

1. Créez un projet Supabase (région Paris), puis collez `supabase/climdevis-installation.sql` (toutes les
   migrations regroupées, généré par `npm run sql:bundle`) dans l'éditeur SQL et exécutez-le.
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
for f in supabase/tests/00_supabase_stubs.sql supabase/migrations/*.sql supabase/tests/10_rls_check.sql supabase/tests/20_catalog_import_check.sql supabase/tests/30_quote_editing_check.sql supabase/tests/40_team_billing_check.sql supabase/tests/50_margin_isolation_check.sql supabase/tests/60_multi_suppliers_check.sql supabase/tests/70_plans_check.sql; do
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

## Plans et implantation (bloc A)

- **Import** : un plan par niveau (PDF rendu en image dans le navigateur avec pdf.js, photo, croquis, plan d'agence), stocké en privé (`plans`).
- **Lecture par Claude** (`src/lib/plans/analyze.server.ts`) : pièces, surfaces et cotes écrites, fenêtres / portes-fenêtres / baies, pièces ouvertes, niveau, flèche du nord. Quota mensuel « analyses de plans ». Rien n'est utilisé avant validation.
- **Échelle** : mesure de l'artisan › cotes du plan › surfaces écrites. **Contrôle** : alerte si la somme des pièces s'écarte de plus de 10 % de la surface du logement.
- **Pièces proposées** : pièces ouvertes fusionnées (décochable), orientation = façade la plus vitrée selon la flèche du nord, vitrage important au-delà de 20 % de la surface au sol ; tout reste modifiable.
- **Implantation** : l'artisan place unités, bouches, grilles, tableau, évacuation, et trace liaisons, condensats, goulottes, gaines, alimentation (+ supplément pour les montées). Longueurs arrondies au demi-mètre supérieur → métré.
- **PDF** : devis seul / devis + annexes (plan + cahier des charges client ; fiches techniques en fichiers séparés) / dossier complet fusionné. Dossier chantier séparé, sans aucun prix.

## Multi-fournisseurs (bloc B)

- **Prix client** : prix public de référence unique (fournisseur de référence de la marque, sinon le plus élevé) × coefficient. Changer de fournisseur ne change que la marge.
- **Prix d'achat** : prix net du tarif, sinon prix public du fournisseur × (1 − remise) ; remise la plus précise : référence › famille de remise (ou gamme) › marque.
- **Choix par défaut** : la combinaison la moins chère au total, frais de port compris (« X € sous un franco de Y € HT », paliers facultatifs). Comparatif « ligne par ligne » / « tout chez X ». Fournisseur imposable par ligne ou pour tout le devis.
- **Frais de port** : coût interne déduit de la marge (« Frais de port » dans « Ma marge »), ou refacturés (ligne « Livraison du matériel »).
- **Rapprochement** : EAN ou référence normalisée identique = certain ; suffixe différent = probable, à confirmer (Fournisseurs › Correspondances).
- **Import PDF** : lecture par Claude (`src/lib/suppliers/pdf-tariff*.ts`), lots de 5 pages, écran de validation, quota de pages par formule, mémoire des PDF déjà lus (empreinte SHA-256). Clé `ANTHROPIC_API_KEY` dans Vercel.
- **Bons de commande** : un PDF par fournisseur (devis accepté), réf. fournisseur + fabricant, quantité, prix net attendu, référence chantier (client + ville, aucun prix client), date de livraison souhaitée.
- **Cloisonnement** : fournisseurs, tarifs, remises, bons de commande et frais de port illisibles en base pour un technicien sans l'option « voir les marges » (`supabase/tests/60_multi_suppliers_check.sql`).

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

## Tableau de bord

- CA signé HT et marge nette signée : devis acceptés dans le mois (date du clic « Accepté », heure de Paris).
- Taux de transformation : parmi les devis envoyés dans le mois, part acceptée à ce jour ; comparaison au mois précédent.
- Relance : devis « envoyé » sans réponse depuis N jours (7 par défaut, réglable), depuis l'envoi ou la dernière
  relance ; bouton « Relancer » = message type via le partage du téléphone, date de relance notée.
- Dupliquer : même client ou autre client (par défaut) ; prix recalculés avec le catalogue actuel, retouches
  conservées, écarts signalés (prix mis à jour, prix d'achat changé sous une retouche).

## Abonnement et équipe

Formules sans engagement (prix nets, éditeur en franchise de TVA) : Solo 49 €/mois ou 490 €/an (1 utilisateur),
Équipe 89 € / 890 € (3), Entreprise 179 € / 1 790 € (10). Offre de lancement : Solo 29 €/mois à vie pour les
50 premiers abonnés (prix Stripe dédié, compteur en base, place jamais rendue).

- Essai de 14 jours sans carte (jusqu'à 10 utilisateurs). Abonnement pris pendant l'essai : premier paiement
  à la fin de l'essai. Fin d'essai ou abonnement inactif : **lecture seule garantie en base** (RLS
  `company_can_write()`), devis et PDF restent consultables.
- Rôles : Administrateur (paramètres, catalogue, abonnement, marges) / Technicien (devis ; marges et prix
  d'achat visibles seulement si l'administrateur l'autorise).
- **Cloisonnement des marges en base** : sans l'option, un technicien ne peut lire ni catalogue avec remises,
  ni prix d'achat, ni historique, ni marge (RLS `current_can_see_margins()`, marge dans `quote_financials`,
  coefficient sur achat illisible) ; vues `*_public` avec prix de vente seulement. Les calculs qui ont besoin
  des coûts sont faits côté serveur (clé service, filtrée par entreprise) et seuls des résultats nettoyés
  partent au navigateur (`src/lib/quote/sanitize.ts`).
- Invitations par e-mail (Supabase Auth) avec lien de secours ; limite d'utilisateurs de la formule, passage
  à la formule supérieure proposé (au prorata).

### Légal et commercial

- Pages publiques : accueil, tarifs, mentions légales, CGV/CGU, confidentialité, accord de traitement (DPA).
  Les informations de l'éditeur sont à compléter dans `src/lib/legal/editor.ts`.
- Acceptation des CGV, de la politique de confidentialité et du DPA obligatoire à l'inscription
  (version et date enregistrées sur le compte).
- Hébergement UE : base Supabase en région Paris, fonctions Vercel en région Paris (`vercel.json`).
- Nouvel inscrit : devis de démonstration prêt à ouvrir ; lien « Aide » permanent dans l'application.

### Mise en place Stripe

1. Créez un produit par formule et 7 prix récurrents en EUR (Solo, Équipe, Entreprise × mensuel / annuel,
   plus « Solo lancement » 29 €/mois). Reportez leurs identifiants dans `.env.local` (`STRIPE_PRICE_*`).
2. Portail client (Paramètres › Billing › Customer portal) : activez la mise à jour de la carte, les
   factures et la résiliation en fin de période.
3. Webhook vers `https://votre-domaine/api/stripe/webhook`, événements : `checkout.session.completed`,
   `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`.
   Copiez le secret dans `STRIPE_WEBHOOK_SECRET`.
4. `SUPABASE_SERVICE_ROLE_KEY` est requise (webhook et invitations) : ne l'exposez jamais au navigateur.

> Franchise de TVA de l'éditeur : seuil de 37 500 € HT de CA annuel en prestations de services (2026).
> Au-delà, activer la TVA dans Stripe (taux 20 %) et retirer la mention des factures.

> Le dimensionnement W/m³ est un ordre de grandeur pour chiffrer, pas un bilan thermique réglementaire.
