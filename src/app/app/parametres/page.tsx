import type { Metadata } from "next";
import { getCurrentCompany } from "@/lib/company/current";
import { companyRowToForm } from "@/lib/company/settings";
import { signedAssetUrl } from "@/lib/company/assets";
import { LinkButton } from "@/components/ui";
import { CompanyForm } from "./CompanyForm";

export const metadata: Metadata = { title: "Paramètres" };

export default async function ParametresPage() {
  const { supabase, company } = await getCurrentCompany();
  const { id, onboarding_done: _done, ...row } = company;
  const [logoUrl, stampUrl] = await Promise.all([signedAssetUrl(supabase, company.logo_path), signedAssetUrl(supabase, company.stamp_path)]);
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-extrabold">Paramètres</h1>
      <LinkButton href="/app/parametres/coefficients" variant="secondary" full>
        Coefficients de dimensionnement et de pose →
      </LinkButton>
      <CompanyForm mode="settings" companyId={id} initial={companyRowToForm(row)} logoUrl={logoUrl} stampUrl={stampUrl} />
    </div>
  );
}
