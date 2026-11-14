import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentCompany } from "@/lib/company/current";
import { centsToInput, decimalToInput } from "@/lib/format";
import { fromSelection } from "@/lib/quote/equipment";
import { companyPricing, loadCoefficients, loadQuote, loadWizardCatalog, siteInfo } from "@/lib/quote/load";
import { toRoomNeeds, type RoomForm } from "@/lib/quote/rooms";
import { Stepper, STEP_LABELS } from "./Stepper";
import { ClientStep } from "./steps/ClientStep";
import { RoomsStep } from "./steps/RoomsStep";
import { SizingStep } from "./steps/SizingStep";
import { SolutionsStep } from "./steps/SolutionsStep";
import { MetreStep } from "./steps/MetreStep";
import { LaborStep } from "./steps/LaborStep";

export const metadata: Metadata = { title: "Devis" };

export default async function QuoteWizardPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ etape?: string }> }) {
  const [{ id }, { etape }] = await Promise.all([params, searchParams]);
  const { supabase, company } = await getCurrentCompany();
  const q = await loadQuote(supabase, id);
  if (!q) notFound();

  const hasRooms = q.rooms.length > 0;
  const maxReached = !hasRooms ? 2 : !q.wizard.selection ? 4 : !q.wizard.metre ? 5 : 6;
  const requested = Math.min(Math.max(Number(etape) || maxReached, 1), 6);
  if (requested > maxReached) redirect(`/app/devis/${id}?etape=${maxReached}`);
  const step = requested;

  const coefs = await loadCoefficients(supabase);
  const pricing = companyPricing(company);
  const site = siteInfo(q);
  const rooms = toRoomNeeds(q.rooms);
  const roomForms: RoomForm[] = q.rooms.map((r) => ({
    id: r.id,
    name: r.name,
    surface: decimalToInput(r.surface_m2),
    height: decimalToInput(r.ceiling_height_m),
    orientation: r.orientation,
    insulation: r.insulation,
    largeGlazing: r.large_glazing,
    underRoof: r.under_roof,
    level: r.level,
    indoorType: r.indoor_type,
    overrideW: r.need_override_watts ? String(r.need_override_watts) : "",
  }));

  let body: React.ReactNode;
  if (step === 1) {
    const p = q.project;
    const c = p.client;
    const same = (p.site_address ?? "") === (c.address_line ?? "") && (p.site_city ?? "") === (c.city ?? "");
    body = (
      <ClientStep
        quoteId={id}
        initial={{
          client_name: c.name,
          client_phone: c.phone ?? "",
          client_email: c.email ?? "",
          client_address: c.address_line ?? "",
          client_postal_code: c.postal_code ?? "",
          client_city: c.city ?? "",
          site_same: same,
          site_address: p.site_address ?? "",
          site_postal_code: p.site_postal_code ?? "",
          site_city: p.site_city ?? "",
          site_citycode: p.site_citycode ?? "",
          site_lat: p.site_lat?.toString() ?? "",
          site_lng: p.site_lng?.toString() ?? "",
          one_way_km: p.one_way_km === null ? "" : decimalToInput(p.one_way_km),
          same_commune: p.same_commune,
          parking_enabled: p.parking_enabled,
          parking_per_day: centsToInput(p.parking_per_day_cents ?? Number(company.parking_per_day_cents)),
        }}
      />
    );
  } else if (step === 2) {
    body = <RoomsStep quoteId={id} initial={roomForms} gainableAccess={q.project.gainable_access} nextStep={3} submitLabel="Suivant : les puissances" />;
  } else if (step === 3) {
    body = <SizingStep quoteId={id} rooms={roomForms} gainableAccess={q.project.gainable_access} sizing={coefs.sizing} />;
  } else {
    const catalog = await loadWizardCatalog(supabase);
    if (step === 4) {
      body = <SolutionsStep quoteId={id} company={pricing} site={site} coefs={coefs} rooms={rooms} products={catalog.products} accessories={catalog.accessories} wizard={q.wizard} />;
    } else {
      const equipment = fromSelection(q.wizard.selection!, catalog.products);
      if (!equipment) redirect(`/app/devis/${id}?etape=4`);
      const props = { quoteId: id, company: pricing, site, coefs, rooms, equipment, accessories: catalog.accessories, wizard: q.wizard };
      body = step === 5 ? <MetreStep {...props} /> : <LaborStep {...props} />;
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href="/app" className="text-lg font-bold text-brand underline underline-offset-4">
          ← Mes devis
        </Link>
        <h1 className="mt-2 text-3xl font-extrabold">
          {q.number} · {q.project.client.name}
        </h1>
        <p className="text-lg text-slate-700">
          Étape {step} : {STEP_LABELS[step - 1]}
        </p>
      </div>
      <Stepper current={step} quoteId={id} maxReached={maxReached} />
      {body}
    </div>
  );
}
