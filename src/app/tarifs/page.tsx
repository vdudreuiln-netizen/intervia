import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PricingTable } from "@/components/PricingTable";
import { LegalFooter } from "@/components/LegalFooter";

export const metadata: Metadata = { title: "Tarifs", description: "ClimDevis : devis climatisation dimensionnés et margés. Solo, Équipe, Entreprise, sans engagement." };
export const dynamic = "force-dynamic";

export default async function TarifsPage() {
  const supabase = await createClient();
  const { data: seats } = await supabase.rpc("launch_seats_left");
  return (
    <>
    <main className="mx-auto max-w-5xl space-y-6 px-4 py-10">
      <Link href="/" className="text-lg font-bold text-brand">
        ClimDevis
      </Link>
      <h1 className="text-4xl font-extrabold">Tarifs</h1>
      <p className="text-lg">14 jours d&apos;essai gratuit, sans carte bancaire. Ensuite, choisissez la formule adaptée à votre équipe.</p>
      <PricingTable seatsLeft={typeof seats === "number" ? seats : 0} signupHref="/connexion?mode=inscription" />
    </main>
    <LegalFooter />
    </>
  );
}
