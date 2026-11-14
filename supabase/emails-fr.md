# Modèles d'e-mails Supabase en français

À copier dans **Supabase › Authentication › Emails › Templates** (onglet de chaque modèle) :
collez le **Sujet** dans « Subject heading » et le **Contenu** dans « Message body »
(mode « Source » / HTML), puis cliquez **Save changes**.

Les éléments entre doubles accolades (`{{ .ConfirmationURL }}`…) sont remplacés
automatiquement par Supabase : ne les modifiez pas.

> Pour que les e-mails partent depuis votre propre adresse (et pas depuis Supabase, limité
> à quelques envois par heure), configurez un serveur SMTP dans **Authentication › Emails ›
> SMTP Settings** (par exemple Brevo ou Mailjet, hébergés en France).

---

## 1. Confirmation d'inscription (« Confirm signup »)

**Sujet**

```
Confirmez votre adresse e-mail – ClimDevis
```

**Contenu**

```html
<div style="font-family: Arial, Helvetica, sans-serif; font-size: 16px; color: #111827; max-width: 560px; margin: 0 auto; line-height: 1.5;">
  <p style="font-size: 20px; font-weight: bold; color: #0B4F8A;">ClimDevis</p>
  <h1 style="font-size: 22px;">Bienvenue !</h1>
  <p>Merci d'avoir créé votre compte ClimDevis. Pour activer votre essai gratuit de 14 jours, confirmez votre adresse e-mail :</p>
  <p style="margin: 28px 0;">
    <a href="{{ .ConfirmationURL }}" style="background: #0B4F8A; color: #ffffff; padding: 14px 24px; border-radius: 10px; text-decoration: none; font-weight: bold;">Confirmer mon adresse</a>
  </p>
  <p style="font-size: 14px; color: #4B5563;">Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur :<br>{{ .ConfirmationURL }}</p>
  <p style="font-size: 14px; color: #4B5563;">Vous n'êtes pas à l'origine de cette inscription ? Ignorez simplement ce message.</p>
</div>
```

---

## 2. Invitation d'un collègue (« Invite user »)

**Sujet**

```
Vous êtes invité(e) à rejoindre {{ .Data.legal_name }} sur ClimDevis
```

**Contenu**

```html
<div style="font-family: Arial, Helvetica, sans-serif; font-size: 16px; color: #111827; max-width: 560px; margin: 0 auto; line-height: 1.5;">
  <p style="font-size: 20px; font-weight: bold; color: #0B4F8A;">ClimDevis</p>
  <h1 style="font-size: 22px;">Rejoignez votre équipe</h1>
  <p><strong>{{ .Data.legal_name }}</strong> vous invite à utiliser ClimDevis, l'outil de chiffrage des installations de climatisation.</p>
  <p>Cliquez sur le bouton ci-dessous, choisissez votre mot de passe et vous accéderez directement aux devis de l'équipe :</p>
  <p style="margin: 28px 0;">
    <a href="{{ .ConfirmationURL }}" style="background: #0B4F8A; color: #ffffff; padding: 14px 24px; border-radius: 10px; text-decoration: none; font-weight: bold;">Accepter l'invitation</a>
  </p>
  <p style="font-size: 14px; color: #4B5563;">Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur :<br>{{ .ConfirmationURL }}</p>
  <p style="font-size: 14px; color: #4B5563;">Vous ne connaissez pas cette entreprise ? Ignorez ce message : aucun compte ne sera activé sans votre clic.</p>
</div>
```

---

## 3. Mot de passe oublié (« Reset password »)

**Sujet**

```
Réinitialisez votre mot de passe – ClimDevis
```

**Contenu**

```html
<div style="font-family: Arial, Helvetica, sans-serif; font-size: 16px; color: #111827; max-width: 560px; margin: 0 auto; line-height: 1.5;">
  <p style="font-size: 20px; font-weight: bold; color: #0B4F8A;">ClimDevis</p>
  <h1 style="font-size: 22px;">Nouveau mot de passe</h1>
  <p>Vous avez demandé à changer le mot de passe de votre compte ClimDevis ({{ .Email }}). Cliquez sur le bouton pour en choisir un nouveau :</p>
  <p style="margin: 28px 0;">
    <a href="{{ .ConfirmationURL }}" style="background: #0B4F8A; color: #ffffff; padding: 14px 24px; border-radius: 10px; text-decoration: none; font-weight: bold;">Choisir un nouveau mot de passe</a>
  </p>
  <p style="font-size: 14px; color: #4B5563;">Ce lien est valable une heure. Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur :<br>{{ .ConfirmationURL }}</p>
  <p style="font-size: 14px; color: #4B5563;">Vous n'avez rien demandé ? Ignorez ce message : votre mot de passe actuel reste valable.</p>
</div>
```

---

## 4. Changement d'adresse e-mail (« Change email address ») — facultatif

**Sujet**

```
Confirmez votre nouvelle adresse e-mail – ClimDevis
```

**Contenu**

```html
<div style="font-family: Arial, Helvetica, sans-serif; font-size: 16px; color: #111827; max-width: 560px; margin: 0 auto; line-height: 1.5;">
  <p style="font-size: 20px; font-weight: bold; color: #0B4F8A;">ClimDevis</p>
  <p>Confirmez le remplacement de l'adresse {{ .Email }} par {{ .NewEmail }} pour votre compte ClimDevis :</p>
  <p style="margin: 28px 0;">
    <a href="{{ .ConfirmationURL }}" style="background: #0B4F8A; color: #ffffff; padding: 14px 24px; border-radius: 10px; text-decoration: none; font-weight: bold;">Confirmer la nouvelle adresse</a>
  </p>
  <p style="font-size: 14px; color: #4B5563;">Vous n'êtes pas à l'origine de cette demande ? Contactez-nous immédiatement.</p>
</div>
```
