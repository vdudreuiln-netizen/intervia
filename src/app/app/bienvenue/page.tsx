import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentCompany } from "@/lib/company/current";
import { companyRowToForm, PERSONAL_FIELDS } from "@/lib/company/settings";
import { signedAssetUrl } from "@/lib/company/assets";
import { loadBrands } from "@/lib/catalog/queries";
import { CompanyForm } from "../parametres/CompanyForm";

export const metadata: Metadata = { title: "Bienvenue" };

export default async function BienvenuePage() {
  const { supabase, company } = await getCurrentCompany();
  if (company.onboarding_done) redirect("/app");
  const { id, onboarding_done: _done, ...row } = company;
  const initial = companyRowToForm(row);
  if (!initial.insurance_coverage) initial.insurance_coverage = "France métropolitaine";
  // Chaque artisan saisit ses propres valeurs (exemples affichés dans les champs)
  for (const f of PERSONAL_FIELDS) initial[f] = "";
  if (!initial.bank_holder) initial.bank_holder = company.legal_name;
  const [logoUrl, stampUrl, brands] = await Promise.all([signedAssetUrl(supabase, company.logo_path), signedAssetUrl(supabase, company.stamp_path), loadBrands(supabase, company.id)]);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-extrabold">Bienvenue !</h1>
        <p className="mt-2 text-lg">5 minutes pour paramétrer votre entreprise. Ces informations apparaîtront sur tous vos devis.</p>
      </div>
      <CompanyForm mode="onboarding" companyId={id} initial={initial} logoUrl={logoUrl} stampUrl={stampUrl} brands={brands.map((b) => ({ id: b.id, name: b.name }))} />
    </div>
  );
}
