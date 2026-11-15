import type { Metadata } from "next";
import { EDITOR, HOSTING } from "@/lib/legal/editor";

export const metadata: Metadata = { title: "Mentions légales" };

export default function MentionsLegales() {
  return (
    <>
      <h1>Mentions légales</h1>
      <p>Informations prévues par l&apos;article 1-1 de la loi n° 2004-575 du 21 juin 2004 pour la confiance dans l&apos;économie numérique (LCEN), dans sa rédaction issue de la loi SREN du 21 mai 2024.</p>
      <h2>Éditeur du service</h2>
      <ul>
        <li>{EDITOR.companyName} — {EDITOR.legalForm}</li>
        <li>
          SIRET : {EDITOR.siret}
          {EDITOR.rcsOrRm && ` — ${EDITOR.rcsOrRm}`}
        </li>
        <li>Adresse : {EDITOR.address}</li>
        <li>
          Contact : {EDITOR.email}
          {EDITOR.phone && ` — ${EDITOR.phone}`}
        </li>
        <li>Directeur de la publication : {EDITOR.publicationDirector}</li>
        <li>{EDITOR.vatMention}</li>
      </ul>
      <h2>Hébergement</h2>
      <ul>
        <li>Application : {HOSTING.app}</li>
        <li>Base de données et authentification : {HOSTING.database}</li>
        <li>Paiements : {HOSTING.payments}</li>
        <li>Lecture des tarifs PDF et des plans (facultative) : {HOSTING.ai}</li>
      </ul>
      <h2>Propriété intellectuelle</h2>
      <p>Le logiciel {EDITOR.productName}, ses textes, interfaces et éléments graphiques sont la propriété de l&apos;éditeur. Toute reproduction non autorisée est interdite. Les données saisies par les utilisateurs (catalogue, clients, devis) restent leur propriété.</p>
      <h2>Contact</h2>
      <p>Pour toute question : {EDITOR.supportEmail}.</p>
    </>
  );
}
