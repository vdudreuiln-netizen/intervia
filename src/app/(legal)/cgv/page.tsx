import type { Metadata } from "next";
import Link from "next/link";
import { EDITOR } from "@/lib/legal/editor";
import { LAUNCH_OFFER, PLANS, TRIAL_DAYS, euros } from "@/lib/billing/plans";

export const metadata: Metadata = { title: "Conditions générales de vente et d'utilisation" };

export default function Cgv() {
  return (
    <>
      <h1>Conditions générales de vente et d&apos;utilisation</h1>
      <p>
        Les présentes conditions (les « CGV ») régissent l&apos;abonnement au logiciel en ligne {EDITOR.productName} (le « Service »), édité par {EDITOR.companyName}, {EDITOR.address} (l&apos;« Éditeur »), et son
        utilisation. Le Service est destiné exclusivement aux professionnels (artisans et entreprises du génie climatique) agissant pour les besoins de leur activité. Les présentes CGV constituent le socle unique de la relation commerciale
        (article L441-1 du Code de commerce).
      </p>

      <h2>1. Objet et description du Service</h2>
      <p>
        Le Service permet de dimensionner des installations de climatisation, de gérer un catalogue de matériel, d&apos;établir des devis et d&apos;en suivre la marge. Les calculs de dimensionnement reposent sur une méthode simplifiée et ne
        remplacent pas un bilan thermique réglementaire ni les préconisations des fabricants. Le Client reste seul responsable des devis qu&apos;il émet, de leurs prix, de leur conformité à la réglementation et de leur exécution.
      </p>

      <h2>2. Inscription et compte</h2>
      <p>
        L&apos;inscription requiert une adresse e-mail valide et l&apos;acceptation des présentes CGV, de la <Link href="/confidentialite">politique de confidentialité</Link> et de l&apos;
        <Link href="/dpa">accord de traitement des données</Link>. Le Client est responsable de la confidentialité de ses identifiants et des actions réalisées par les utilisateurs qu&apos;il invite.
      </p>

      <h2>3. Essai gratuit</h2>
      <p>
        Chaque nouveau compte bénéficie d&apos;un essai gratuit de {TRIAL_DAYS} jours, sans carte bancaire et sans engagement. À l&apos;issue de l&apos;essai, en l&apos;absence d&apos;abonnement, le compte passe en lecture seule : les
        devis existants restent consultables et téléchargeables, la création et la modification sont suspendues.
      </p>

      <h2>4. Formules et prix</h2>
      <ul>
        {Object.values(PLANS).map((p) => (
          <li key={p.id}>
            {p.name} : {p.maxUsers === 1 ? "1 utilisateur" : `jusqu'à ${p.maxUsers} utilisateurs`}, {euros(p.monthCents)} par mois ou {euros(p.yearCents)} par an.
          </li>
        ))}
        <li>
          Offre de lancement (dans la limite de {LAUNCH_OFFER.seats} abonnés) : formule Solo à {euros(LAUNCH_OFFER.monthCents)} par mois, prix maintenu tant que l&apos;abonnement n&apos;est pas résilié ni changé de formule.
        </li>
      </ul>
      <p>
        Prix nets, {EDITOR.vatMention}. Si l&apos;Éditeur devient redevable de la TVA, elle sera ajoutée au taux en vigueur, après information du Client. L&apos;Éditeur peut faire évoluer ses tarifs pour les nouvelles périodes en informant le
        Client au moins 30 jours à l&apos;avance ; le Client peut alors résilier avant l&apos;échéance.
      </p>

      <h2>5. Paiement</h2>
      <p>
        L&apos;abonnement est payable d&apos;avance, par carte bancaire ou prélèvement, via le prestataire Stripe, pour chaque période (mois ou année). Les factures sont mises à disposition dans l&apos;espace de gestion de l&apos;abonnement.
        Conformément aux articles L441-10 et D441-5 du Code de commerce, tout retard de paiement entraîne de plein droit, dès le lendemain de l&apos;échéance, des pénalités au taux de la Banque centrale européenne majoré de 10 points, ainsi
        qu&apos;une indemnité forfaitaire pour frais de recouvrement de 40 €. En cas d&apos;échec de paiement, l&apos;accès peut être restreint en lecture seule après relance.
      </p>

      <h2>6. Durée, résiliation, changement de formule</h2>
      <p>
        L&apos;abonnement est sans engagement et se renouvelle automatiquement à chaque période. Le Client peut le résilier à tout moment depuis l&apos;espace « Abonnement » ; la résiliation prend effet à la fin de la période payée, sans
        remboursement prorata. Le passage à une formule supérieure est facturé au prorata de la période en cours. L&apos;Éditeur peut résilier en cas de manquement grave du Client (non-paiement, usage illicite), après mise en demeure restée
        sans effet pendant 15 jours.
      </p>

      <h2>7. Données du Client et réversibilité</h2>
      <p>
        Le Client reste propriétaire de ses données. Pour les données personnelles de ses propres clients, l&apos;Éditeur agit en qualité de sous-traitant au sens de l&apos;article 28 du RGPD, selon l&apos;
        <Link href="/dpa">accord de traitement des données</Link>, qui fait partie intégrante des présentes. Pendant 30 jours après la fin de l&apos;abonnement, le Client peut récupérer ses devis (PDF) ; ses données sont ensuite supprimées,
        sauf obligation légale de conservation.
      </p>

      <h2>8. Disponibilité et support</h2>
      <p>
        L&apos;Éditeur met en œuvre les moyens raisonnables pour assurer l&apos;accès au Service 24 h/24 et 7 j/7, hors maintenance et cas de force majeure (obligation de moyens). Le support est accessible par e-mail ({EDITOR.supportEmail})
        les jours ouvrés.
      </p>

      <h2>9. Responsabilité</h2>
      <p>
        Le Service est un outil d&apos;aide au chiffrage. Les prix, coefficients, remises et données techniques sont saisis sous la responsabilité du Client, qui vérifie chaque devis avant de l&apos;envoyer. La responsabilité de l&apos;Éditeur,
        toutes causes confondues, est limitée aux sommes versées par le Client au titre des 12 derniers mois et exclut les dommages indirects (perte de chiffre d&apos;affaires, de marge ou de clientèle).
      </p>

      <h2>10. Propriété intellectuelle</h2>
      <p>L&apos;Éditeur concède au Client, pour la durée de l&apos;abonnement, un droit d&apos;utilisation personnel et non exclusif du Service. Toute copie, revente ou ingénierie inverse est interdite.</p>

      <h2>11. Modification des CGV</h2>
      <p>Toute modification est notifiée au Client au moins 30 jours avant son entrée en vigueur. La poursuite de l&apos;utilisation après cette date vaut acceptation.</p>

      <h2>12. Droit applicable et litiges</h2>
      <p>Les présentes CGV sont soumises au droit français. À défaut d&apos;accord amiable, tout litige entre professionnels relève de la compétence exclusive du tribunal de commerce de {EDITOR.court}.</p>
    </>
  );
}
