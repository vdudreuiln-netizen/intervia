import { readFile } from "node:fs/promises";
import path from "node:path";
import { createElement, type ReactElement } from "react";
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { loadQuote } from "@/lib/quote/load";
import { EMPTY_METRE } from "@/lib/quote/types";
import { loadRuleContext } from "@/lib/plans/rules.server";
import { costAccess } from "@/lib/security/costs";
import { pdfResponse, storedImage } from "@/lib/site/pdf.server";
import { CerfaPdf } from "@/lib/site/CerfaPdf";
import { fillOfficialCerfa } from "@/lib/site/cerfa-fill";
import { buildCerfaSheets, type CerfaInput } from "@/lib/site/cerfa";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const addr = (a: string | null, cp: string | null, city: string | null) => [a, [cp, city].filter(Boolean).join(" ")].filter(Boolean).join(", ");

/**
 * Fiche d'intervention fluides : CERFA 15497*04 pré-rempli (France) ou fiche
 * générique (autres pays), une page par unité extérieure, numéro unique par compte.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, db, company, companyId } = await costAccess();
  const q = await loadQuote(supabase, id);
  if (!q) return new Response("Chantier introuvable", { status: 404 });
  const rc = await loadRuleContext(supabase, db, companyId, q, company.placement_rules);
  if (!rc) return new Response("Aucun matériel choisi sur ce devis.", { status: 409 });

  // Numéro attribué une seule fois par chantier (compteur propre au compte)
  const { data: number, error } = await supabase.rpc("assign_fluid_form_number", { p_quote_id: id });
  if (error || typeof number !== "string") return new Response("Numéro de fiche indisponible (accès en lecture seule ?).", { status: 403 });

  const [{ data: job }, { data: client }] = await Promise.all([
    supabase.from("site_jobs").select("commissioning, fluid_form").eq("quote_id", id).maybeSingle(),
    supabase.from("clients").select("siret").eq("id", q.project.client.id).maybeSingle(),
  ]);
  const form = { ...((job?.fluid_form as CerfaInput | null) ?? { systems: {} }), number };
  const c = q.project.client;
  const sheets = buildCerfaSheets({
    country: company.country ?? "FR",
    number,
    company: {
      name: company.legal_name,
      address: addr(company.address_line, company.postal_code, company.city),
      siret: company.siret,
      capacityNumber: company.fluid_capacity_number,
      leakDetectorId: company.leak_detector_id,
      leakDetectorCheckedOn: company.leak_detector_checked_on,
    },
    client: { name: c.name, address: addr(c.address_line, c.postal_code, c.city) || addr(q.project.site_address, q.project.site_postal_code, q.project.site_city), siret: (client?.siret as string | null) ?? null },
    installationAddress: addr(q.project.site_address, q.project.site_postal_code, q.project.site_city),
    equipment: rc.equipment,
    metre: q.wizard.metre ?? EMPTY_METRE,
    tech: rc.tech,
    commissioning: (job?.commissioning as Record<string, string> | null) ?? {},
    form: { systems: form.systems ?? {}, operatorSign: form.operatorSign, holderSign: form.holderSign },
  });
  const sig = async (p: string | null | undefined) => (p && p.startsWith(`${companyId}/${id}/`) ? await storedImage(supabase, "chantier", p) : null);
  const signatures = { operator: await sig(form.operatorSign?.signaturePath), holder: await sig(form.holderSign?.signaturePath) };
  if (sheets[0]?.format === "cerfa") {
    // France : formulaire officiel CERFA 15497*04 (service-public.gouv.fr) rempli champ par champ
    const template = await readFile(path.join(process.cwd(), "src/lib/site/cerfa/cerfa_15497-04.pdf"));
    const bytes = await fillOfficialCerfa(new Uint8Array(template), sheets, signatures);
    return pdfResponse(Buffer.from(bytes), `CERFA-15497-${number}.pdf`);
  }
  const element = createElement(CerfaPdf, { sheets, company: company.legal_name, signatures }) as unknown as ReactElement<DocumentProps>;
  return pdfResponse(await renderToBuffer(element), `Fiche-intervention-${number}.pdf`);
}
