import type { Metadata } from "next";
import { getCurrentCompany } from "@/lib/company/current";
import { centsToInput } from "@/lib/format";
import { ClientStep } from "../[id]/steps/ClientStep";
import { Stepper } from "../[id]/Stepper";

export const metadata: Metadata = { title: "Nouveau devis" };

export default async function NewQuotePage() {
  const { company } = await getCurrentCompany();
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-extrabold">Nouveau devis</h1>
      <Stepper current={1} quoteId={null} />
      <ClientStep
        quoteId={null}
        initial={{
          client_name: "",
          client_phone: "",
          client_email: "",
          client_address: "",
          client_postal_code: "",
          client_city: "",
          site_same: true,
          site_address: "",
          site_postal_code: "",
          site_city: "",
          site_citycode: "",
          site_lat: "",
          site_lng: "",
          one_way_km: "",
          same_commune: false,
          parking_enabled: false,
          parking_per_day: centsToInput(Number(company.parking_per_day_cents)),
        }}
      />
    </div>
  );
}
