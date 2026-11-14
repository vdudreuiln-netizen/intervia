import { redirect } from "next/navigation";
import { getCurrentCompany } from "@/lib/company/current";
import { Card, LinkButton } from "@/components/ui";

export default async function AppHome() {
  const { company } = await getCurrentCompany();
  if (!company.onboarding_done) redirect("/app/bienvenue");
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-extrabold">Mes devis</h1>
      <Card>
        <p className="text-lg">Votre entreprise est paramétrée. La création de devis arrive à l&apos;étape suivante du développement.</p>
        <LinkButton href="/app/parametres" variant="secondary" full>
          Voir mes paramètres
        </LinkButton>
      </Card>
    </div>
  );
}
