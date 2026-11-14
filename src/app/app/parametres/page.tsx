import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentCompany } from "@/lib/company/current";
import { companyRowToForm } from "@/lib/company/settings";
import { signedAssetUrl } from "@/lib/company/assets";
import { loadBrands } from "@/lib/catalog/queries";
import { LinkButton } from "@/components/ui";
import { CompanyForm } from "./CompanyForm";

export const metadata: Metadata = { title: "Paramètres" };

export default async function ParametresPage() {
  const { supabase, company , role } = await getCurrentCompany();
  if (role !== "admin") redirect("/app");
  const { id, onboarding_done: _done, ...row } = company;
  const [logoUrl, stampUrl, brands] = await Promise.all([signedAssetUrl(supabase, company.logo_path), signedAssetUrl(supabase, company.stamp_path), loadBrands(supabase)]);
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-extrabold">Paramètres</h1>
      <div className="grid gap-3 sm:grid-cols-3">
        <LinkButton href="/app/equipe" variant="secondary" full>
          Mon équipe →
        </LinkButton>
        <LinkButton href="/app/abonnement" variant="secondary" full>
          Abonnement →
        </LinkButton>
        <LinkButton href="/app/parametres/coefficients" variant="secondary" full>
          Coefficients →
        </LinkButton>
      </div>
      <CompanyForm mode="settings" companyId={id} initial={companyRowToForm(row)} logoUrl={logoUrl} stampUrl={stampUrl} brands={brands.map((b) => ({ id: b.id, name: b.name }))} />
    </div>
  );
}
