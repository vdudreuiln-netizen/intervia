import { LinkButton } from "@/components/ui";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-8 px-4 py-10">
      <div>
        <p className="text-lg font-bold text-brand">ClimDevis</p>
        <h1 className="mt-2 text-4xl font-extrabold leading-tight">Votre devis clim dimensionné et margé en moins de 10 minutes.</h1>
        <ul className="mt-6 space-y-2 text-lg">
          <li>✔ Toutes vos marques, avec vos remises fournisseur</li>
          <li>✔ Puissance calculée pièce par pièce</li>
          <li>✔ Votre marge nette par jour, en direct</li>
          <li>✔ PDF propre, prêt à signer</li>
        </ul>
      </div>
      <div className="flex flex-col gap-3">
        <LinkButton href="/connexion?mode=inscription" full>
          Essai gratuit 14 jours
        </LinkButton>
        <p className="text-center text-base text-slate-600">Sans carte bancaire. Ensuite à partir de 49 €/mois, sans engagement.</p>
        <LinkButton href="/connexion" variant="secondary" full>
          J&apos;ai déjà un compte
        </LinkButton>
        <LinkButton href="/tarifs" variant="ghost" full>
          Voir les tarifs
        </LinkButton>
      </div>
    </main>
  );
}
