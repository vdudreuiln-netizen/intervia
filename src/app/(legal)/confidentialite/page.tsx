import type { Metadata } from "next";
import Link from "next/link";
import { EDITOR, HOSTING } from "@/lib/legal/editor";

export const metadata: Metadata = { title: "Politique de confidentialité" };

export default function Confidentialite() {
  return (
    <>
      <h1>Politique de confidentialité</h1>
      <p>
        Cette politique explique comment {EDITOR.companyName} (l&apos;« Éditeur ») traite les données personnelles dans le cadre du logiciel {EDITOR.productName}, conformément au règlement (UE) 2016/679 (RGPD) et à la loi Informatique et
        Libertés.
      </p>

      <h2>1. Deux situations différentes</h2>
      <ul>
        <li>
          <strong>Vos données d&apos;utilisateur</strong> (artisan et collègues invités) : l&apos;Éditeur est <strong>responsable de traitement</strong>. C&apos;est l&apos;objet de cette politique.
        </li>
        <li>
          <strong>Les données de vos propres clients</strong> (noms, adresses de chantier, téléphones, devis) : vous êtes responsable de traitement, l&apos;Éditeur agit comme <strong>sous-traitant</strong> selon l&apos;
          <Link href="/dpa">accord de traitement des données (DPA)</Link>. Il incombe à l&apos;artisan d&apos;informer ses clients de ce traitement.
        </li>
      </ul>

      <h2>2. Données collectées et finalités</h2>
      <ul>
        <li>Compte : e-mail, nom, mot de passe (chiffré) — fourniture du Service (exécution du contrat).</li>
        <li>Entreprise : raison sociale, SIRET, adresse, assurance, coordonnées bancaires figurant sur les devis — fourniture du Service (exécution du contrat).</li>
        <li>Facturation de l&apos;abonnement : traitée par Stripe ; l&apos;Éditeur ne stocke pas vos numéros de carte — exécution du contrat et obligations comptables.</li>
        <li>Journaux techniques et sécurité — intérêt légitime (sécurité du Service).</li>
        <li>Échanges avec le support — intérêt légitime (assistance).</li>
      </ul>

      <h2>3. Durées de conservation</h2>
      <ul>
        <li>Données du compte et de l&apos;entreprise : pendant l&apos;abonnement, puis 30 jours (récupération), puis suppression.</li>
        <li>Pièces comptables liées à l&apos;abonnement : 10 ans (article L123-22 du Code de commerce).</li>
        <li>Journaux techniques : 12 mois maximum.</li>
      </ul>

      <h2>4. Hébergement et destinataires</h2>
      <p>Les données sont hébergées dans l&apos;Union européenne :</p>
      <ul>
        <li>Base de données et authentification : {HOSTING.database}.</li>
        <li>Application : {HOSTING.app}.</li>
        <li>Paiements : {HOSTING.payments}.</li>
        <li>
          Lecture automatique des tarifs fournisseurs en PDF (uniquement si vous l&apos;utilisez) : {HOSTING.ai}. Seules les pages de tarif que vous choisissez sont transmises ; elles ne contiennent normalement aucune donnée personnelle de vos
          clients. Selon les conditions commerciales du prestataire, ces données ne servent pas à entraîner ses modèles.
        </li>
        <li>
          Lecture automatique des plans de logement (uniquement si vous l&apos;utilisez) : {HOSTING.ai}. L&apos;image du plan est transmise ; elle peut comporter le nom ou l&apos;adresse de votre client si ceux-ci figurent sur le plan.
          Conseil : masquez le cartouche si vous ne souhaitez pas les transmettre.
        </li>
        <li>Géocodage des adresses : Institut national de l&apos;information géographique et forestière (IGN, Géoplateforme, France) — seules les adresses saisies sont transmises.</li>
        <li>Envoi des e-mails : service d&apos;envoi intégré de Supabase (phase de test, à remplacer par un prestataire dédié avant le premier client payant).</li>
      </ul>
      <p>
        Certains prestataires appartiennent à des groupes établis hors de l&apos;Union européenne (Vercel Inc., Supabase Inc.). Les éventuels transferts sont encadrés par les clauses contractuelles types de la Commission européenne et, le cas
        échéant, par le cadre de protection des données UE–États-Unis (Data Privacy Framework). Les données ne sont jamais vendues ni utilisées à des fins publicitaires.
      </p>

      <h2>5. Sécurité</h2>
      <p>
        Chiffrement des échanges (HTTPS), mots de passe chiffrés, cloisonnement strict des données entre entreprises au niveau de la base de données, droits par rôle (administrateur / technicien), sauvegardes chez l&apos;hébergeur.
      </p>

      <h2>6. Vos droits</h2>
      <p>
        Vous disposez d&apos;un droit d&apos;accès, de rectification, d&apos;effacement, de limitation, d&apos;opposition et de portabilité. Écrivez à {EDITOR.dpoContact}. Vous pouvez également introduire une réclamation auprès de la CNIL
        (www.cnil.fr).
      </p>

      <h2>7. Cookies</h2>
      <p>Le Service n&apos;utilise que des cookies strictement nécessaires (maintien de la connexion). Aucun cookie publicitaire ni de mesure d&apos;audience tiers n&apos;est déposé : aucun consentement n&apos;est donc requis.</p>
    </>
  );
}
