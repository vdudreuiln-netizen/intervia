import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PricingTable } from "@/components/PricingTable";
import { LegalFooter } from "@/components/LegalFooter";
import { LAUNCH_OFFER, euros } from "@/lib/billing/plans";

export const metadata: Metadata = {
  title: { absolute: "ClimDevis – Le devis climatisation dimensionné et margé en 10 minutes" },
  description: "Logiciel de devis pour artisans climaticiens : dimensionnement pièce par pièce, catalogue multi-marques, marge nette en direct, PDF conforme. Essai gratuit 14 jours.",
};
export const dynamic = "force-dynamic";

const ADVANTAGES = [
  {
    icon: "📐",
    title: "Le bon matériel, toutes marques",
    text: "Puissance calculée pièce par pièce, puis 3 options côte à côte (Éco, Confort, Premium) piochées dans vos tarifs fournisseurs : mono, multi-split ou gainable.",
  },
  {
    icon: "💶",
    title: "Votre marge, en direct",
    text: "Marge nette et marge par jour de chantier toujours affichées. Alerte rouge si une ligne passe sous son coût ou sous votre objectif. Arrondi « prix psychologique » sans perdre d'argent.",
  },
  {
    icon: "📄",
    title: "Un devis conforme, prêt à signer",
    text: "PDF propre avec vos mentions légales, la décennale, le médiateur, le formulaire de rétractation et l'acompte au bon moment. À partager depuis le téléphone.",
  },
];

const SCREENS = [
  { src: "/captures/solutions.webp", alt: "Trois solutions multi-split comparées : prix client, marge nette et marge par jour", caption: "3 solutions comparées en un coup d'œil" },
  { src: "/captures/marge.webp", alt: "Panneau « Ma marge » : coût d'achat, charges, marge nette et marge par jour", caption: "Votre marge réelle, jamais visible du client" },
  { src: "/captures/pdf.webp", alt: "Devis PDF avec fourniture, main d'œuvre, mise en service et mentions légales", caption: "Le devis PDF envoyé au client" },
  { src: "/captures/tableau.webp", alt: "Tableau de bord : chiffre d'affaires signé, marge et taux de transformation du mois", caption: "Votre mois en chiffres" },
];

export default async function Home() {
  let seats = 0;
  try {
    const supabase = await createClient();
    const { data } = await supabase.rpc("launch_seats_left");
    seats = typeof data === "number" ? data : 0;
  } catch {
    seats = 0;
  }

  return (
    <div className="bg-white">
      <header className="border-b-2 border-slate-200">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
          <span className="text-2xl font-extrabold text-brand">ClimDevis</span>
          <nav className="flex items-center gap-4 text-base font-bold">
            <a href="#tarifs" className="text-brand underline">
              Tarifs
            </a>
            <Link href="/connexion" className="text-brand underline">
              Connexion
            </Link>
          </nav>
        </div>
      </header>

      <main>
        <section className="mx-auto grid max-w-5xl items-center gap-8 px-4 py-10 md:grid-cols-2 md:py-16">
          <div>
            <p className="text-base font-bold uppercase tracking-wide text-brand">Pour les artisans climaticiens</p>
            <h1 className="mt-2 text-4xl font-extrabold leading-tight md:text-5xl">Un devis clim dimensionné et margé en 10 minutes.</h1>
            <p className="mt-4 text-xl text-slate-700">Sur votre téléphone, sur le chantier. Toutes vos marques, vos remises fournisseur, votre marge nette en direct.</p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <Link href="/connexion?mode=inscription" className="flex min-h-14 items-center justify-center rounded-xl bg-brand px-8 text-lg font-bold text-white">
                Essai gratuit 14 jours
              </Link>
              <a href="#tarifs" className="flex min-h-14 items-center justify-center rounded-xl border-2 border-brand px-8 text-lg font-bold text-brand">
                Voir les tarifs
              </a>
            </div>
            <p className="mt-3 text-base text-slate-600">Sans carte bancaire. Un devis de démonstration vous attend dès l&apos;inscription.</p>
            {seats > 0 && (
              <p className="mt-4 inline-block rounded-xl bg-amber-100 px-4 py-2 text-base font-bold text-amber-900">
                Offre de lancement : {euros(LAUNCH_OFFER.monthCents)}/mois à vie — plus que {seats} place{seats > 1 ? "s" : ""}
              </p>
            )}
          </div>
          <div className="mx-auto w-full max-w-xs overflow-hidden rounded-[2rem] border-8 border-slate-900 shadow-2xl">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={SCREENS[0]!.src} alt={SCREENS[0]!.alt} width={390} height={760} className="block h-auto w-full" />
          </div>
        </section>

        <section className="bg-slate-50 py-12">
          <div className="mx-auto grid max-w-5xl gap-6 px-4 md:grid-cols-3">
            {ADVANTAGES.map((a) => (
              <div key={a.title} className="rounded-2xl border-2 border-slate-200 bg-white p-6">
                <p className="text-4xl" aria-hidden>
                  {a.icon}
                </p>
                <h2 className="mt-3 text-2xl font-extrabold">{a.title}</h2>
                <p className="mt-2 text-lg text-slate-700">{a.text}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-5xl px-4 py-12">
          <h2 className="text-3xl font-extrabold">Concrètement, ça ressemble à ça</h2>
          <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {SCREENS.map((s) => (
              <figure key={s.src} className="overflow-hidden rounded-2xl border-2 border-slate-200 bg-slate-50">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={s.src} alt={s.alt} loading="lazy" className="block h-80 w-full object-cover object-top" />
                <figcaption className="p-3 text-base font-bold">{s.caption}</figcaption>
              </figure>
            ))}
          </div>
          <p className="mt-3 text-sm text-slate-500">Captures réalisées avec des données d&apos;exemple (marques et prix fictifs).</p>
        </section>

        <section id="tarifs" className="bg-slate-50 py-12">
          <div className="mx-auto max-w-5xl px-4">
            <h2 className="mb-6 text-3xl font-extrabold">Tarifs simples, sans engagement</h2>
            <PricingTable seatsLeft={seats} signupHref="/connexion?mode=inscription" />
          </div>
        </section>

        <section className="mx-auto max-w-3xl px-4 py-14 text-center">
          <h2 className="text-3xl font-extrabold">Votre prochain devis, en 10 minutes.</h2>
          <p className="mt-3 text-lg text-slate-700">14 jours pour l&apos;essayer sur vos vrais chantiers. Aucune carte bancaire demandée.</p>
          <Link href="/connexion?mode=inscription" className="mt-6 inline-flex min-h-14 items-center justify-center rounded-xl bg-brand px-10 text-lg font-bold text-white">
            Essai gratuit 14 jours
          </Link>
        </section>
      </main>
      <LegalFooter />
    </div>
  );
}
