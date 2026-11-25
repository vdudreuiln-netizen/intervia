# Mettre ClimDevis en ligne — guide pas à pas

Ce guide ne demande aucune connaissance technique. **Une action par étape.** Suivez-les dans l'ordre :
certaines informations obtenues à une étape servent plus loin.

Les noms de boutons sont ceux des interfaces en anglais de Supabase, Stripe et Vercel (avec la traduction
quand l'interface est en français). Ces sites changent parfois un libellé : si un bouton porte un nom un peu
différent, cherchez le plus proche.

**Durée : environ 1 h 30.** Préparez un bloc-notes (sur l'ordinateur) pour y coller les valeurs au fur et à mesure.

> 🔒 Les « clés » et « secrets » que vous allez copier donnent accès à vos données et à vos paiements.
> Ne les envoyez à personne, ne les collez dans aucune conversation, ni dans un e-mail : uniquement dans
> Vercel (partie D).

---

## Partie A — Fusionner le code sur GitHub (2 min)

1. Ouvrez https://github.com/vdudreuiln-netizen/intervia/pull/1
2. Cliquez sur **Merge pull request**.
3. Cliquez sur **Confirm merge**.

## Partie B — Compléter vos informations d'éditeur (10 min)

Ce sont VOS informations (vendeur de ClimDevis), affichées dans les mentions légales et les CGV.

4. Sur GitHub, ouvrez le fichier `src/lib/legal/editor.ts` (dossier `src` › `lib` › `legal`).
5. Cliquez sur l'icône **crayon** (« Edit this file ») en haut à droite du fichier.
6. Remplacez chaque texte `[À COMPLÉTER : …]` par votre information (gardez les guillemets autour).
7. Cliquez sur **Commit changes…**, puis encore sur **Commit changes**.

> Faites relire les pages CGV, confidentialité et DPA par un juriste ou votre expert-comptable avant de vendre :
> ce sont des modèles sérieux, mais ils doivent correspondre à votre situation exacte.

---

## Partie C — Supabase : la base de données (20 min)

### Créer le projet

8. Allez sur https://supabase.com et cliquez sur **Start your project** (créez un compte si besoin).
9. Cliquez sur **New project**.
10. **Name** : tapez `climdevis`.
11. **Database Password** : cliquez sur **Generate a password**, puis copiez-le dans votre bloc-notes (« Mot de passe base »).
12. **Region** : choisissez **West EU (Paris)** — obligatoire pour l'hébergement en Europe annoncé dans vos documents.
13. Cliquez sur **Create new project** et attendez 1 à 2 minutes que le projet soit prêt.

### Installer les tables

14. Sur GitHub, ouvrez le fichier `supabase/climdevis-installation.sql`.
15. Cliquez sur l'icône **Copy raw file** (deux carrés superposés, en haut à droite du fichier).
16. Dans Supabase, menu de gauche : cliquez sur **SQL Editor**.
17. Cliquez sur **+ New query** (ou **New SQL snippet**).
18. Cliquez dans la grande zone de texte et collez (Ctrl+V / Cmd+V).
19. Cliquez sur **Run** (en bas à droite). Résultat attendu : « Success. No rows returned ».
    *À faire une seule fois. Si une erreur s'affiche, ne relancez pas : notez le message et contactez votre développeur.*

### Récupérer les clés

20. Menu de gauche : **Project Settings** (roue dentée) › **Data API** (ou **API**). Copiez **Project URL** dans le bloc-notes (« SUPABASE URL »).
21. Toujours dans Project Settings : **API Keys**.
22. Copiez la clé **Publishable key** (commence par `sb_publishable_`) dans le bloc-notes (« SUPABASE PUBLIQUE »).
23. Dans la partie **Secret keys**, cliquez sur **Reveal** puis copiez la clé (commence par `sb_secret_`) dans le bloc-notes (« SUPABASE SECRÈTE »).
    *Si votre projet n'affiche que l'onglet « Legacy API Keys » : utilisez `anon public` pour la publique et `service_role` pour la secrète.*

### E-mails en français

24. Menu de gauche : **Authentication** › **Emails** (ou **Email Templates**).
25. Pour chacun des modèles **Confirm signup**, **Invite user**, **Reset password** (et **Change email address**) :
    copiez le **Sujet** et le **Contenu** depuis le fichier `supabase/emails-fr.md` de GitHub, collez-les
    dans **Subject** et **Message body**, puis cliquez sur **Save changes**.

> Recommandé avant d'avoir de vrais clients : **Authentication › Emails › SMTP Settings** pour envoyer les
> e-mails depuis votre adresse via un service comme Brevo (français). Sans cela, Supabase limite à quelques
> e-mails par heure.

---

## Partie D — Vercel : mettre l'application en ligne (15 min)

26. Allez sur https://vercel.com et cliquez sur **Sign Up** › **Continue with GitHub**.
27. Sur votre tableau de bord Vercel, cliquez sur **Add New…** › **Project**.
28. Dans la liste **Import Git Repository**, trouvez `intervia` et cliquez sur **Import**.
    *Si le dépôt n'apparaît pas : cliquez sur **Adjust GitHub App Permissions** et autorisez-le.*
29. Dépliez **Environment Variables**.
30. Ajoutez ces 4 variables une par une (**Key** à gauche, **Value** à droite, puis **Add**) :

| Key | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | « SUPABASE URL » |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | « SUPABASE PUBLIQUE » (`sb_publishable_…`) |
| `SUPABASE_SERVICE_ROLE_KEY` | « SUPABASE SECRÈTE » (`sb_secret_…`) |
| `NEXT_PUBLIC_SUPPORT_EMAIL` | votre adresse e-mail de support |

31. Cliquez sur **Deploy** et attendez 2 à 3 minutes (« Congratulations! »).
32. Cliquez sur **Continue to Dashboard**, puis copiez l'adresse affichée sous **Domains**
    (ex. `climdevis-xxxx.vercel.app`) dans le bloc-notes (« ADRESSE DU SITE »), précédée de `https://`.
33. Onglet **Settings** › **Environment Variables** : ajoutez `NEXT_PUBLIC_APP_URL` = « ADRESSE DU SITE »
    (ex. `https://climdevis-xxxx.vercel.app`, **sans** barre `/` à la fin), puis **Save**.

> Vos données restent en Europe : le fichier `vercel.json` du projet fait tourner l'application dans la région
> Paris (`cdg1`). Vous pouvez le vérifier dans **Settings › Functions › Function Region**.

### Autoriser l'adresse du site dans Supabase

34. Dans Supabase : **Authentication** › **URL Configuration**.
35. **Site URL** : collez « ADRESSE DU SITE », puis **Save**.
36. **Redirect URLs** › **Add URL** : collez « ADRESSE DU SITE » suivie de `/auth/callback`
    (ex. `https://climdevis-xxxx.vercel.app/auth/callback`), puis **Save URLs**.

---

## Partie E — Stripe en mode test : les 7 prix et le webhook (30 min)

37. Allez sur https://dashboard.stripe.com et créez votre compte (ou connectez-vous).
38. En haut à droite, activez **Test mode** (« Mode test »), ou ouvrez un **Sandbox** si Stripe vous le propose.
    Tout ce qui suit se fait en test : aucun vrai paiement.

### Les 3 produits et 7 prix

39. Menu : **Product catalog** (« Catalogue de produits ») › **+ Create product** (« + Ajouter un produit »).
40. **Name** : `ClimDevis Solo`.
41. Prix : choisissez **Recurring** (« Récurrent »), **Amount** `49,00`, **EUR**, **Billing period** **Monthly** (« Mensuel »).
42. Cliquez sur **Add product** (« Ajouter le produit »).
43. Sur la page du produit, section **Pricing**, cliquez sur **+ Add another price** : Recurring, `490,00` EUR, **Yearly** (« Annuel »), puis **Add price**.
44. Encore **+ Add another price** : Recurring, `29,00` EUR, **Monthly**, et dans **Price description** tapez `Offre de lancement`. **Add price**.
    *Ne modifiez ni ne supprimez jamais ce prix : les 50 premiers abonnés y restent liés à vie.*
45. Répétez les étapes 39 à 43 pour **ClimDevis Équipe** : `89,00` mensuel puis `890,00` annuel.
46. Répétez les étapes 39 à 43 pour **ClimDevis Entreprise** : `179,00` mensuel puis `1 790,00` annuel.
47. Pour chacun des 7 prix : cliquez sur le prix, puis copiez son identifiant (commence par `price_…`, bouton
    copier à côté de l'ID) dans le bloc-notes, avec le nom de la variable correspondante :

| Prix | Variable |
|---|---|
| Solo 49 €/mois | `STRIPE_PRICE_SOLO_MONTHLY` |
| Solo 490 €/an | `STRIPE_PRICE_SOLO_YEARLY` |
| Solo 29 €/mois (lancement) | `STRIPE_PRICE_LAUNCH` |
| Équipe 89 €/mois | `STRIPE_PRICE_EQUIPE_MONTHLY` |
| Équipe 890 €/an | `STRIPE_PRICE_EQUIPE_YEARLY` |
| Entreprise 179 €/mois | `STRIPE_PRICE_ENTREPRISE_MONTHLY` |
| Entreprise 1 790 €/an | `STRIPE_PRICE_ENTREPRISE_YEARLY` |

### Le portail client (résiliation, carte, factures)

48. Roue dentée **Settings** (« Paramètres ») › **Billing** › **Customer portal**.
49. Cochez **Customers can update their payment methods**, **Invoice history**, et **Customers can cancel subscriptions**
    avec **At the end of the billing period** (« À la fin de la période de facturation »).
50. Cliquez sur **Save changes** (« Enregistrer »).

### Le webhook (Stripe prévient ClimDevis des abonnements)

51. Menu **Developers** (« Développeurs ») › **Webhooks**.
52. Cliquez sur **+ Add endpoint** (ou **Add destination**, puis choisissez **Webhook endpoint**).
53. **Endpoint URL** : « ADRESSE DU SITE » suivie de `/api/stripe/webhook`
    (ex. `https://climdevis-xxxx.vercel.app/api/stripe/webhook`).
54. **Select events** : cochez exactement ces 4 événements :
    `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`,
    `customer.subscription.deleted`.
55. Cliquez sur **Add endpoint** (ou **Create destination**).
56. Sur la page du webhook, **Signing secret** › **Reveal** : copiez la valeur (commence par `whsec_…`)
    dans le bloc-notes (« WEBHOOK SECRET »).

### La clé secrète Stripe

57. **Developers** › **API keys** : à la ligne **Secret key**, cliquez sur **Reveal test key** et copiez-la
    (commence par `sk_test_…`) dans le bloc-notes (« STRIPE SECRÈTE »).

---

## Partie F — Brancher Stripe sur l'application (10 min)

58. Dans Vercel : votre projet › **Settings** › **Environment Variables**.
59. Ajoutez une par une (**Add** à chaque fois) :

| Key | Value |
|---|---|
| `STRIPE_SECRET_KEY` | « STRIPE SECRÈTE » |
| `STRIPE_WEBHOOK_SECRET` | « WEBHOOK SECRET » |
| les 7 `STRIPE_PRICE_…` | les identifiants `price_…` du tableau de l'étape 47 |

60. Onglet **Deployments** : sur la ligne du haut, cliquez sur **⋯** › **Redeploy** › **Redeploy**.
    *Indispensable : les variables ne sont prises en compte qu'après un nouveau déploiement.*

---

## Partie F bis — Lecture des tarifs PDF et des plans par l'IA (facultatif, 5 min)

Sans cette clé, tout fonctionne : import Excel / CSV des tarifs, et pièces dessinées à la main sur le plan.

- Sur **console.anthropic.com**, créez un compte, ajoutez un moyen de paiement, puis **API Keys** › **Create Key**.
- Réglez une **limite de dépenses mensuelle** (Settings › Limits) : c'est votre filet de sécurité en plus des quotas
  par formule de ClimDevis (tarifs PDF : 300 / 1 000 / 3 000 pages ; plans : 30 / 100 / 300 analyses par mois).
- Dans Vercel › **Settings** › **Environment Variables**, ajoutez `ANTHROPIC_API_KEY` = la clé (ne la collez nulle part ailleurs), puis **Redeploy**.
- Facultatif : `ANTHROPIC_TARIFF_MODEL` et `ANTHROPIC_PLAN_MODEL` pour changer de modèle (par défaut `claude-opus-5-5`).
- Test : **Catalogue › Importer un tarif**, choisissez un PDF, sélectionnez 2 ou 3 pages de prix, vérifiez les lignes lues puis le résumé.

> Base neuve ? `supabase/climdevis-installation.sql` contient déjà toutes les migrations (y compris les espaces de
> stockage « plans », « datasheets » et « chantier ») : passez directement à la partie G.

---

## Partie F ter — Mettre à jour une base déjà en service (migrations 10 à 14)

> Guide détaillé pour un non-développeur (installation de l'outil de sauvegarde, commandes Windows / Mac,
> mise en ligne, vérifications) : **`DEPLOYER-CETTE-VERSION.md`**.

**Toujours sauvegarder AVANT d'exécuter une migration.** Une migration ne s'annule pas d'un clic.

### 1. Sauvegarder (10 min)

1. Supabase › **Database** › **Backups** : notez la date de la dernière sauvegarde automatique quotidienne.
   Selon votre formule Supabase, elle peut ne pas être téléchargeable : faites donc aussi l'export ci-dessous.
2. Supabase › bouton **Connect** (en haut) › **Session pooler** : copiez l'adresse de connexion
   (`postgresql://postgres.xxxx:[MOT-DE-PASSE]@…pooler.supabase.com:5432/postgres`) et remplacez `[MOT-DE-PASSE]`
   par le « Mot de passe base » (étape 11). Ne collez cette adresse nulle part ailleurs que dans le terminal.
3. Sur un ordinateur où PostgreSQL est installé (commande `pg_dump`), lancez :
   ```
   pg_dump "ADRESSE-COPIÉE" --format=custom --no-owner -f climdevis-avant-migration-13.dump
   ```
   Vérifiez que le fichier fait plus de quelques Ko, puis copiez-le hors de l'ordinateur (clé USB, cloud).
   *Les photos et plans (espaces de stockage) ne sont pas dans ce fichier : ils ne sont pas modifiés par les migrations.*
4. En cas de problème après la migration, la restauration se fait avec
   `pg_restore --clean --no-owner -d "ADRESSE-COPIÉE" climdevis-avant-migration-13.dump` (à faire faire par votre développeur).

### 2. Exécuter les migrations manquantes, dans l'ordre, une seule fois

Supabase › **SQL Editor** › **+ New query**, collez le fichier puis **Run** :

| Si votre base a été installée… | Exécutez dans l'ordre |
|---|---|
| avant les blocs B et A | `…10_multi_suppliers.sql`, `…11_plans.sql`, `…12_placement_and_site.sql`, `…13_validation_fixes.sql`, `…14_reference_catalog.sql` |
| avec le bloc A (plans) mais sans le mode chantier | `…12_placement_and_site.sql`, `…13_validation_fixes.sql`, `…14_reference_catalog.sql` |
| avec le mode chantier (migration 12) | `…13_validation_fixes.sql`, `…14_reference_catalog.sql` |
| avec la migration 13 | `…14_reference_catalog.sql` |

Tous les fichiers sont dans `supabase/migrations/`. Résultat attendu à chaque fois : « Success. No rows returned ».
*En cas d'erreur, ne relancez pas : notez le message, gardez la sauvegarde et contactez votre développeur.*

La migration 13 ajoute : les avenants comptés au chiffre d'affaires, les 3 accessoires de fixation d'exemple
(chevilles chimiques, fixation ITE, support toiture : **vérifiez leurs prix dans Catalogue › Accessoires**), le pays du compte,
le détecteur de fuite, le SIRET des clients et la numérotation des fiches d'intervention fluides (FI-AAAA-NNNN).

### 3. Compléter vos paramètres

**Paramètres › Règles d'implantation et fiche fluides** : pays (France = CERFA 15497*04), n° d'attestation de capacité,
détecteur de fuite (identification + date du dernier contrôle). Le tableau « recoupement avec les notices » est informatif (il ne bloque rien).

> Les plans déjà implantés affichent désormais 2 alertes rouges par unité tant que le **support vérifié** et le
> **sol dégagé** (unité extérieure) ne sont pas renseignés : c'est voulu.

---

## Partie G — Tester de bout en bout (15 min)

61. Ouvrez « ADRESSE DU SITE » : la page d'accueil s'affiche avec les tarifs et « Plus que 50 places ».
62. Cliquez sur **Essai gratuit 14 jours**, créez un compte avec une vraie adresse e-mail et cochez la case des conditions.
63. Ouvrez l'e-mail « Confirmez votre adresse e-mail – ClimDevis » et cliquez sur **Confirmer mon adresse**.
64. Remplissez l'onboarding, puis ouvrez le **devis de démonstration** dans « Mes devis ».
65. Créez un vrai devis avec **+ Nouveau devis** jusqu'à **Créer le devis**, puis **Voir le PDF**.
66. **Paramètres › Abonnement** : choisissez **Je profite de l'offre**.
67. Payez avec la carte de test Stripe : `4242 4242 4242 4242`, date future, CVC `123`.
68. Revenez dans ClimDevis : après quelques secondes, l'abonnement apparaît comme actif.
    Dans Stripe, **Developers › Webhooks** › votre webhook : les événements doivent être marqués réussis (200).
69. **Paramètres › Mon équipe** : invitez une deuxième adresse e-mail en **Technicien** et vérifiez
    qu'elle reçoit l'invitation en français et ne voit pas les marges.

### Scénario chantier complet (20 min, à refaire après chaque mise à jour)

70. **Devis** : créez un devis avec une unité murale. Dans l'éditeur, essayez de passer une ligne sous son prix d'achat :
    le message « aucune ligne ne peut être vendue à perte » doit bloquer. Vérifiez la marge de chaque ligne et du devis.
71. **Implantation** : importez un plan, placez l'unité intérieure (hauteur de pose 1,8 m ou 1,0 m sous fenêtre) et
    l'unité extérieure. Choisissez le **support vérifié** (ex. « chevilles chimiques »), cochez **sol dégagé**, validez,
    puis vérifiez dans le devis que la ligne « Kit de scellement chimique » a été ajoutée.
72. Marquez le devis **Accepté**, ouvrez **Chantiers** › le chantier.
73. **Mise en service** : saisissez le n° de série et la charge ajoutée. **CERFA fluides** : vérifiez la charge totale,
    le tonnage éq. CO2 et la fréquence ; signez (opérateur et détenteur), **Enregistrer**, puis ouvrez le PDF :
    le numéro FI-AAAA-0001 apparaît et reste le même si vous rouvrez le PDF.
74. **Écarts** : signalez un écart, chiffrez-le (vente ≥ coût), créez l'avenant, marquez-le **accepté**.
75. **Tableau de bord** : le chiffre d'affaires signé du mois affiche « Montant initial + Avenants (1) = Total ».

---

## Partie H — Passer en réel (le jour du lancement)

76. Dans Stripe, désactivez **Test mode** et refaites les **parties E et F** en mode réel
    (les prix, le webhook et les clés sont différents en réel : `sk_live_…`, nouveaux `price_…`, nouveau `whsec_…`).
77. Dans Vercel, remplacez les valeurs Stripe par les valeurs réelles, puis **Redeploy** (étape 60).
78. Facultatif : achetez un nom de domaine et ajoutez-le dans Vercel › **Settings** › **Domains** › **Add**,
    puis mettez à jour `NEXT_PUBLIC_APP_URL` (étape 33), l'adresse Supabase (étapes 35-36) et l'URL du webhook Stripe (étape 53).

---

### Récapitulatif des variables Vercel

| Variable | Où la trouver |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase › Project Settings › Data API › Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase › Project Settings › API Keys › Publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase › Project Settings › API Keys › Secret key |
| `NEXT_PUBLIC_APP_URL` | Vercel › votre projet › Domains (avec `https://`, sans `/` final) |
| `NEXT_PUBLIC_SUPPORT_EMAIL` | votre adresse de support |
| `STRIPE_SECRET_KEY` | Stripe › Developers › API keys › Secret key |
| `STRIPE_WEBHOOK_SECRET` | Stripe › Developers › Webhooks › votre webhook › Signing secret |
| `STRIPE_PRICE_…` (7) | Stripe › Product catalog › chaque prix › ID `price_…` |
| `ANTHROPIC_API_KEY` (facultatif) | console.anthropic.com › API Keys (lecture des tarifs PDF) |

### En cas de problème

- **« Variables NEXT_PUBLIC_SUPABASE_URL… manquantes »** : une variable est mal nommée ou absente (partie D), puis Redeploy.
- **Le lien de l'e-mail mène à une erreur** : vérifiez les étapes 35-36 (adresse exacte, `https://`, `/auth/callback`).
- **Abonnement payé mais pas actif** : Stripe › Webhooks › votre webhook › onglet des événements : si erreur 400,
  le `STRIPE_WEBHOOK_SECRET` ne correspond pas (attention test / réel) ; corrigez puis Redeploy.
- **« Paiement indisponible (prix Stripe non configuré) »** : un des 7 `STRIPE_PRICE_…` manque ou contient une faute.
