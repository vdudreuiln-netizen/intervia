import type { Metadata } from "next";
import { EDITOR, HOSTING } from "@/lib/legal/editor";

export const metadata: Metadata = { title: "Accord de traitement des données" };

export default function Dpa() {
  return (
    <>
      <h1>Accord de traitement des données (DPA)</h1>
      <p>
        Le présent accord, conclu en application de l&apos;article 28 du RGPD, fait partie intégrante des conditions générales de vente et d&apos;utilisation de {EDITOR.productName}. Il est accepté par le Client lors de son inscription.
      </p>

      <h2>1. Rôles</h2>
      <p>
        Le Client (artisan ou entreprise abonnée) est <strong>responsable de traitement</strong> des données personnelles de ses propres clients et prospects qu&apos;il saisit dans le Service. {EDITOR.companyName} (l&apos;« Éditeur ») est son{" "}
        <strong>sous-traitant</strong>.
      </p>

      <h2>2. Description du traitement</h2>
      <ul>
        <li>Objet : hébergement et traitement des données nécessaires à l&apos;établissement et au suivi des devis.</li>
        <li>Durée : durée de l&apos;abonnement, puis 30 jours.</li>
        <li>Personnes concernées : clients et prospects du Client.</li>
        <li>Données : identité, coordonnées (adresse, téléphone, e-mail), adresse et caractéristiques du chantier, contenu des devis.</li>
        <li>Aucune donnée sensible au sens de l&apos;article 9 du RGPD n&apos;est attendue.</li>
      </ul>

      <h2>3. Engagements de l&apos;Éditeur</h2>
      <ul>
        <li>traiter les données uniquement sur instruction documentée du Client (l&apos;utilisation du Service vaut instruction) ;</li>
        <li>garantir la confidentialité : les personnes autorisées à accéder aux données sont soumises à une obligation de confidentialité ;</li>
        <li>mettre en œuvre les mesures de sécurité décrites à l&apos;article 5 ;</li>
        <li>ne recourir à un autre sous-traitant qu&apos;avec l&apos;autorisation générale du Client, en l&apos;informant de tout changement envisagé, le Client pouvant s&apos;y opposer ;</li>
        <li>aider le Client à répondre aux demandes d&apos;exercice des droits des personnes concernées ;</li>
        <li>notifier au Client toute violation de données dans les meilleurs délais et au plus tard 48 heures après en avoir pris connaissance ;</li>
        <li>aider le Client pour les analyses d&apos;impact et la consultation de l&apos;autorité de contrôle, le cas échéant ;</li>
        <li>au terme du contrat, supprimer les données après 30 jours, sauf obligation légale de conservation ;</li>
        <li>mettre à disposition du Client les informations nécessaires pour démontrer le respect de ces obligations et permettre des audits raisonnables, à ses frais, avec un préavis de 30 jours.</li>
      </ul>

      <h2>4. Sous-traitants ultérieurs autorisés</h2>
      <ul>
        <li>Hébergement de la base de données : {HOSTING.database}.</li>
        <li>Hébergement de l&apos;application : {HOSTING.app}.</li>
        <li>
          Lecture automatique des tarifs fournisseurs en PDF (uniquement si vous l&apos;utilisez) : {HOSTING.ai}. Seules les pages de tarif que vous choisissez sont transmises ; elles ne contiennent normalement aucune donnée personnelle de vos
          clients. Selon les conditions commerciales du prestataire, ces données ne servent pas à entraîner ses modèles.
        </li>
        <li>Géocodage des adresses de chantier : IGN, Géoplateforme (France).</li>
        <li>Envoi d&apos;e-mails : service d&apos;envoi intégré de Supabase (phase de test, à remplacer par un prestataire dédié avant le premier client payant).</li>
      </ul>

      <h2>5. Mesures de sécurité</h2>
      <ul>
        <li>Chiffrement des communications (TLS) et des mots de passe.</li>
        <li>Cloisonnement des données par entreprise au niveau de la base (Row-Level Security) ; aucune entreprise ne peut accéder aux données d&apos;une autre.</li>
        <li>Contrôle d&apos;accès par rôle ; données de coûts réservées aux utilisateurs autorisés.</li>
        <li>Sauvegardes quotidiennes assurées par l&apos;hébergeur de la base de données.</li>
      </ul>

      <h2>6. Obligations du Client</h2>
      <p>Le Client garantit disposer d&apos;une base légale pour les données qu&apos;il saisit, informer ses clients de ce traitement et ne saisir que les données nécessaires à ses devis.</p>

      <p>Contact données personnelles : {EDITOR.dpoContact}.</p>
    </>
  );
}
