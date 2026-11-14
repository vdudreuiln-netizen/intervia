import type { Metadata } from "next";
import Link from "next/link";
import { getCurrentCompany } from "@/lib/company/current";
import { EDITOR } from "@/lib/legal/editor";
import { Card } from "@/components/ui";

export const metadata: Metadata = { title: "Aide et contact" };

const FAQ: { q: string; a: string }[] = [
  { q: "Par où commencer ?", a: "Ouvrez le devis de démonstration dans « Mes devis », puis cliquez « + Nouveau devis » : client, pièces, puissances, solutions, métré, main d'œuvre. Comptez moins de 10 minutes." },
  { q: "Comment mettre mes vrais prix ?", a: "Catalogue › « Importer un tarif » avec le fichier Excel de votre fournisseur, puis réglez vos remises dans l'onglet Marques. Supprimez ensuite le catalogue d'exemple." },
  { q: "Pourquoi un bandeau rouge sur mon PDF ?", a: "Une mention obligatoire manque (médiateur de la consommation, SIRET ou assurance décennale). Complétez-la dans Paramètres : le bandeau disparaît." },
  { q: "Mon client a signé chez lui : que faire ?", a: "Laissez cochée la case « Signé chez le client » : le devis inclut le formulaire de rétractation de 14 jours et l'acompte n'est payable qu'après 7 jours." },
  { q: "Comment inviter un collègue ?", a: "Paramètres › Mon équipe › « Inviter un collègue ». Choisissez s'il voit ou non vos marges." },
];

export default async function AidePage() {
  const { company, user } = await getCurrentCompany();
  const subject = encodeURIComponent(`Support ClimDevis – ${company.legal_name}`);
  const body = encodeURIComponent(`Bonjour,\n\n[Décrivez votre question ou le problème rencontré]\n\n—\nEntreprise : ${company.legal_name}\nCompte : ${user.email ?? ""}`);
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-extrabold">Aide et contact</h1>
      <Card title="Nous contacter">
        <p className="text-lg">Une question, un bug, une idée ? Réponse sous 1 jour ouvré.</p>
        <a href={`mailto:${EDITOR.supportEmail}?subject=${subject}&body=${body}`} className="flex min-h-14 items-center justify-center rounded-xl bg-brand px-6 text-lg font-bold text-white">
          Écrire au support
        </a>
        <p className="text-base text-slate-700">
          E-mail : <strong>{EDITOR.supportEmail}</strong>
        </p>
      </Card>
      <Card title="Questions fréquentes">
        {FAQ.map((f) => (
          <details key={f.q} className="rounded-xl bg-slate-100 p-3">
            <summary className="cursor-pointer text-lg font-bold">{f.q}</summary>
            <p className="mt-2 text-base">{f.a}</p>
          </details>
        ))}
      </Card>
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-base">
        <Link href="/cgv" className="underline">CGV / CGU</Link>
        <Link href="/confidentialite" className="underline">Confidentialité</Link>
        <Link href="/dpa" className="underline">Traitement des données</Link>
        <Link href="/mentions-legales" className="underline">Mentions légales</Link>
      </p>
    </div>
  );
}
