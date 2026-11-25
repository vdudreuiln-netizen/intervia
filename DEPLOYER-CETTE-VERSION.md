# Déployer cette version de ClimDevis — pas à pas

Pour : mettre en production la version « chantier + CERFA + avenants » (mise à jour d'un ClimDevis déjà en ligne).
Durée : 45 min environ. **Une action par étape, dans l'ordre.**

> Vous n'avez encore jamais mis ClimDevis en ligne ? Suivez plutôt `MISE-EN-LIGNE.md` depuis le début :
> une installation neuve contient déjà toutes les migrations.

> 🔒 Le mot de passe de la base et l'adresse de connexion donnent accès à toutes vos données.
> Ne les collez que dans les écrans indiqués ici (terminal de votre ordinateur, Supabase). Jamais dans un e-mail ou une conversation.

**Ordre à respecter : 1. sauvegarde → 2. migrations de la base → 3. mise en ligne du code.**
Le nouveau code lit des colonnes créées par les migrations : si on met le code en ligne avant, l'application affiche une erreur.

---

## Étape 1 — Savoir où en est votre base (2 min)

1. Ouvrez https://supabase.com/dashboard et cliquez sur votre projet `climdevis`.
2. Menu de gauche : **SQL Editor** › **+ New query**.
3. Collez ce texte, puis cliquez sur **Run** :

```sql
select
  to_regclass('public.supplier_offers')  is not null as migration_10,
  to_regclass('public.quote_plans')      is not null as migration_11,
  to_regclass('public.site_jobs')        is not null as migration_12,
  to_regclass('public.quote_amendments') is not null as migration_13,
  to_regclass('public.ref_brands')       is not null as migration_14,
  to_regclass('public.catalog_import_changes') is not null as migration_15;
```

4. Notez le résultat (« true » = déjà fait, « false » = à faire). Exemple : `true | true | false | false | false | false`
   → il faudra exécuter la 12, puis la 13, la 14 et la 15.

> **Les migrations 13, 14 et 15 sont obligatoires avec cette version** (13 : avenants, CERFA, pays du compte ;
> 14 : catalogue commun et remises ; 15 : import de tarif personnel, source des prix, annulation d'import).
> Le code les utilise : sans elles, le catalogue et l'import affichent une erreur.

---

## Étape 2 — Sauvegarder la base (15 min, une seule fois pour l'installation)

### 2a. Installer l'outil de sauvegarde `pg_dump` (gratuit)

**Windows**
1. Allez sur https://www.postgresql.org/download/windows/ › **Download the installer** (EDB).
2. Choisissez la version **17** pour Windows x86-64, téléchargez, lancez l'installeur.
3. À l'écran **Select Components**, cochez **uniquement « Command Line Tools »**, puis **Next** jusqu'à **Finish**.

**Mac**
1. Allez sur https://postgresapp.com › **Downloads**, téléchargez **Postgres.app** (dernière version).
2. Ouvrez le fichier téléchargé et glissez **Postgres** dans **Applications**. (Inutile de le démarrer.)

### 2b. Récupérer l'adresse de connexion

1. Dans Supabase, en haut de la page du projet : bouton **Connect**.
2. Onglet **Connection String**, type **URI**, méthode **Session pooler**.
3. Copiez l'adresse, de la forme :
   `postgresql://postgres.abcdefgh:[YOUR-PASSWORD]@aws-0-eu-west-3.pooler.supabase.com:5432/postgres`
4. Dans votre bloc-notes, remplacez `[YOUR-PASSWORD]` (crochets compris) par le « Mot de passe base ».
   *Mot de passe perdu ? **Project Settings** › **Database** › **Reset database password** › générez-en un nouveau
   (lettres et chiffres seulement) : ClimDevis ne l'utilise pas, rien d'autre à changer.*

### 2c. Lancer la sauvegarde

**Windows** : menu Démarrer › tapez `PowerShell` › ouvrez **Windows PowerShell**, puis collez (en remplaçant `ADRESSE` par l'adresse complète de l'étape 2b, en gardant les guillemets) et appuyez sur Entrée :

```powershell
& "C:\Program Files\PostgreSQL\17\bin\pg_dump.exe" "ADRESSE" --format=custom --no-owner --file "$HOME\Desktop\climdevis-avant-migrations.dump"
```

**Mac** : ouvrez **Terminal** (Applications › Utilitaires), collez (même remplacement) et appuyez sur Entrée :

```bash
/Applications/Postgres.app/Contents/Versions/latest/bin/pg_dump "ADRESSE" --format=custom --no-owner --file ~/Desktop/climdevis-avant-migrations.dump
```

5. Attendez le retour à la ligne de commande (quelques secondes à 1 minute), sans message d'erreur.
6. Vérifiez sur le **Bureau** le fichier `climdevis-avant-migrations.dump` : il doit faire **plus de 100 Ko**.
7. Copiez-le en lieu sûr (clé USB ou cloud personnel).

En cas de message d'erreur :
- `server version mismatch` → votre `pg_dump` est trop ancien : installez la version la plus récente (étape 2a).
- `password authentication failed` → mot de passe faux dans l'adresse (étape 2b).
- `could not translate host name` → l'adresse est incomplète : recopiez-la depuis **Connect**.

*Les photos, plans et signatures (stockage Supabase) ne sont pas dans ce fichier : les migrations n'y touchent pas.*

---

## Étape 3 — Exécuter les migrations (5 min)

Pour **chaque** migration marquée « false » à l'étape 1, **dans l'ordre 10 → 11 → 12 → 13 → 14 → 15** :

1. Ouvrez le lien du fichier sur GitHub :
   - 10 : https://github.com/vdudreuiln-netizen/intervia/blob/claude/climdevis-mvp-saas-kwvmye/supabase/migrations/20261115000010_multi_suppliers.sql
   - 11 : https://github.com/vdudreuiln-netizen/intervia/blob/claude/climdevis-mvp-saas-kwvmye/supabase/migrations/20261116000011_plans.sql
   - 12 : https://github.com/vdudreuiln-netizen/intervia/blob/claude/climdevis-mvp-saas-kwvmye/supabase/migrations/20261117000012_placement_and_site.sql
   - 13 : https://github.com/vdudreuiln-netizen/intervia/blob/claude/climdevis-mvp-saas-kwvmye/supabase/migrations/20261125000013_validation_fixes.sql
   - 14 : https://github.com/vdudreuiln-netizen/intervia/blob/claude/climdevis-mvp-saas-kwvmye/supabase/migrations/20261126000014_reference_catalog.sql
   - 15 : https://github.com/vdudreuiln-netizen/intervia/blob/claude/climdevis-mvp-saas-kwvmye/supabase/migrations/20261127000015_personal_tariffs.sql
2. Cliquez sur l'icône **Copy raw file** (deux carrés superposés, en haut à droite du fichier).
3. Supabase › **SQL Editor** › **+ New query** › collez › **Run**.
4. Résultat attendu : « Success. No rows returned ».
   **En cas d'erreur : n'exécutez rien d'autre**, notez le message exact et gardez la sauvegarde.
5. Une fois toutes faites, relancez la requête de l'étape 1 : les 6 colonnes doivent afficher **true**.

---

## Étape 4 — Mettre le code en ligne (5 min)

1. Ouvrez https://github.com/vdudreuiln-netizen/intervia/pull/1
2. En bas de la page : **Merge pull request** › **Confirm merge**.
3. Vercel met en ligne automatiquement : ouvrez https://vercel.com › votre projet › onglet **Deployments**.
4. La ligne du haut (« Production ») passe de **Building** à **Ready** en 2 à 4 minutes.
   - **Error** au lieu de Ready : cliquez dessus, copiez les dernières lignes rouges du journal et transmettez-les à votre développeur. Le site reste sur l'ancienne version, rien n'est cassé.
5. En cas de souci après la mise en ligne : **Deployments** › la version précédente › menu **⋯** › **Instant Rollback**
   (le code revient en arrière ; la base reste migrée, ce qui est sans danger pour l'ancienne version).

---

## Étape 5 — Compléter vos paramètres (5 min)

Connectez-vous à ClimDevis avec votre compte administrateur :

1. **Paramètres › Règles d'implantation et fiche fluides** : pays **France**, **n° d'attestation de capacité**,
   **détecteur de fuite** (marque, modèle, n°) et **date de son dernier contrôle** › **Enregistrer**.
2. **Catalogue › Accessoires** : vérifiez les prix des 3 fixations d'exemple (kit de scellement chimique,
   fixation ITE, support toiture / terrasse) ou remplacez-les par vos articles.

---

## Étape 6 — Vérifications en production (20 min)

Cochez au fur et à mesure. Utilisez un client fictif à votre nom.

**Devis**
- [ ] **Mes devis › + Nouveau devis** : créez un devis avec une unité murale, allez jusqu'à **Créer le devis**.
- [ ] Dans l'aperçu, **Modifier le prix** d'une ligne à un prix inférieur à son prix d'achat : un message bloque
      (« aucune ligne ne peut être vendue à perte »).
- [ ] La marge de chaque ligne et la marge du devis s'affichent.

**Implantation**
- [ ] À l'étape **Pièces** de l'assistant : **📐 Importer le plan du logement** (photo ou PDF), validez les pièces.
- [ ] À l'étape **Métré** : **📐 Implanter sur le plan**, placez l'unité intérieure et l'unité extérieure.
- [ ] Unité extérieure : choisissez le **support vérifié** (ex. « chevilles chimiques ») et cochez **sol dégagé** ;
      unité intérieure : support et **hauteur de pose**.
- [ ] **Valider l'implantation**, terminez l'assistant (**Créer le devis**) : la ligne « Kit de scellement chimique » apparaît dans le devis.

**Chantier et CERFA**
- [ ] Dans l'aperçu du devis, bouton de statut **Accepté**, puis menu **Chantiers** › ouvrez le chantier.
- [ ] Onglet **Mise en service** : saisissez le **n° de série** et la **charge ajoutée** › **Enregistrer les relevés**.
- [ ] Onglet **CERFA fluides** : vérifiez charge totale, tonnage éq. CO2 et fréquence ;
      signez au doigt (opérateur puis détenteur) › **Utiliser cette signature** › **Enregistrer la fiche**.
- [ ] **CERFA 15497*04 pré-rempli (PDF)** : le formulaire officiel s'ouvre, numéro **FI-AAAA-0001**,
      cases cochées, signatures dans « Date et signature ». Rouvrez-le : le numéro ne change pas.

**Avenant**
- [ ] Onglet **Écarts** : **Signaler un écart** (ex. 2 m de liaison en plus), renseignez **Prix HT** et **Coût** (prix ≥ coût) › **Chiffrer**.
- [ ] Cochez-le › **Préparer l'avenant (1)** › ouvrez le PDF de l'avenant › **Accepté par le client**.

**Import de tarif personnel**
- [ ] **Catalogue › Importer un tarif** : « Mon distributeur », cochez **Prix publics**, date du tarif, fichier CSV ou Excel.
      Le résumé affiche nouvelles / mises à jour / en erreur ; s'il y a des erreurs, **Télécharger le rapport d'erreurs**.
- [ ] **Valider l'import**, puis dans le catalogue : sous chaque prix, « Prix public : Tarif importé du JJ/MM/AAAA ».
- [ ] Revenez sur **Importer un tarif** : **↶ Annuler le dernier import** remet les prix d'avant.

**Tableau de bord**
- [ ] **Accueil** : le chiffre d'affaires signé du mois affiche **Montant initial + Avenants (1) = Total**.

Quand tout est coché : supprimez le client fictif si vous le souhaitez. La version est en production.
