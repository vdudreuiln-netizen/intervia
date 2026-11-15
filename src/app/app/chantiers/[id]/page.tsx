import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Notice } from "@/components/ui";
import { loadQuote } from "@/lib/quote/load";
import { EMPTY_METRE } from "@/lib/quote/types";
import { equipmentTags } from "@/lib/plans/layout";
import { loadRuleContext } from "@/lib/plans/rules.server";
import { costAccess } from "@/lib/security/costs";
import { checkCommissioning, commissioningSections, siteItems, type Checks, type DevLine, type DeviationKind, type DeviationStatus, type JobStatus, type Reception, type Values } from "@/lib/site/site";
import { SiteJob, type DeviationView, type PhotoView, type PlanView } from "./SiteJob";

export const metadata: Metadata = { title: "Chantier" };

export default async function SiteJobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, db, companyId, company, restricted, role } = await costAccess();
  const q = await loadQuote(supabase, id);
  if (!q) notFound();
  const back = (
    <Link href="/app/chantiers" className="text-lg font-bold text-brand underline underline-offset-4">
      ← Chantiers
    </Link>
  );
  if (q.status !== "accepte") {
    return (
      <div className="space-y-6">
        {back}
        <Notice>Le mode chantier s&apos;ouvre quand le devis {q.number} est marqué « Accepté ».</Notice>
      </div>
    );
  }
  const rc = await loadRuleContext(supabase, db, companyId, q, company.placement_rules);
  if (!rc) {
    return (
      <div className="space-y-6">
        {back}
        <Notice tone="danger">Ce devis n&apos;a pas de matériel choisi dans l&apos;assistant : le mode chantier a besoin d&apos;une solution (étape 4 du devis).</Notice>
      </div>
    );
  }
  const [{ data: job }, { data: photoRows }, { data: devRows }, { data: accessories }] = await Promise.all([
    supabase.from("site_jobs").select("*").eq("quote_id", id).maybeSingle(),
    supabase.from("site_photos").select("id, path, element_id, level, x, y, kind, caption, created_at").eq("quote_id", id).order("created_at"),
    supabase.from("site_deviations").select("id, kind, equipment_key, quantity, description, status, amendment_number, created_at").eq("quote_id", id).order("created_at"),
    supabase.from("catalog_accessories_public").select("id, name, diameter, unit, category").eq("active", true).order("name").limit(500),
  ]);
  const signedPlans = rc.planRows.length ? (await supabase.storage.from("plans").createSignedUrls(rc.planRows.map((p) => p.imagePath), 3600)).data ?? [] : [];
  const signedPhotos = (photoRows ?? []).length ? (await supabase.storage.from("chantier").createSignedUrls((photoRows ?? []).map((p) => p.path as string), 3600)).data ?? [] : [];
  const urlOf = new Map([...signedPlans, ...signedPhotos].map((s) => [s.path ?? "", s.signedUrl]));

  const plans: PlanView[] = rc.planRows.flatMap((p) => {
    const url = urlOf.get(p.imagePath);
    return url ? [{ level: p.level, label: p.label ?? `Niveau ${p.level}`, url, width: p.width, height: p.height }] : [];
  });
  const items = siteItems(rc.plans.map((p) => ({ level: p.level, layout: p.layout })), rc.equipment);
  const photos: PhotoView[] = (photoRows ?? []).flatMap((p) => {
    const url = urlOf.get(p.path as string);
    return url ? [{ id: p.id, url, elementId: p.element_id, level: p.level, x: p.x === null ? null : Number(p.x), y: p.y === null ? null : Number(p.y), kind: p.kind, caption: p.caption }] : [];
  });

  // Surcoûts : membres autorisés seulement (table cloisonnée en base)
  const costRows = !restricted && (devRows ?? []).length ? (await db.from("site_deviation_costs").select("*").eq("company_id", companyId).in("deviation_id", (devRows ?? []).map((d) => d.id))).data ?? [] : [];
  const costOf = new Map(costRows.map((c) => [c.deviation_id as string, c]));
  const deviations: DeviationView[] = (devRows ?? []).map((d) => {
    const c = costOf.get(d.id);
    return {
      id: d.id,
      kind: d.kind as DeviationKind,
      description: d.description,
      quantity: d.quantity === null ? null : Number(d.quantity),
      status: d.status as DeviationStatus,
      amendment: d.amendment_number,
      createdAt: d.created_at,
      costs: c ? { priced: ((c.lines as DevLine[]) ?? []).length > 0, extraPurchaseCents: Number(c.extra_purchase_cents), extraSaleCents: Number(c.extra_sale_cents), marginIfBilledCents: Number(c.margin_if_billed_cents), marginIfAbsorbedCents: Number(c.margin_if_absorbed_cents) } : null,
    };
  });

  const tags = equipmentTags(rc.equipment);
  const roomName = new Map(q.rooms.map((r) => [r.id, r.name]));
  const indoors = rc.equipment.systems.flatMap((s) => s.indoors.map((i) => ({ key: i.key, label: `${tags.indoor.get(i.key)} – ${i.roomIds.map((r) => roomName.get(r) ?? "").join(", ")}` })));
  const sections = commissioningSections(rc.equipment, q.wizard.metre ?? EMPTY_METRE);
  const values = ((job?.commissioning as Values | null) ?? {}) as Values;

  return (
    <div className="space-y-6">
      {back}
      <h1 className="text-3xl font-extrabold">
        {q.project.client.name} <span className="block text-lg font-semibold text-slate-600">{[q.project.site_address, q.project.site_city].filter(Boolean).join(", ")} · {q.number}</span>
      </h1>
      <SiteJob
        quoteId={id}
        companyId={companyId}
        status={(job?.status ?? "a_venir") as JobStatus}
        plans={plans}
        items={items}
        checks={((job?.checks as Checks | null) ?? {}) as Checks}
        photos={photos}
        deviations={deviations}
        indoors={indoors}
        accessories={(accessories ?? []).map((a) => ({ id: a.id as string, label: [a.name, a.diameter].filter(Boolean).join(" ") }))}
        sections={sections}
        values={values}
        commissioningCheck={checkCommissioning(sections, values, rc.equipment)}
        reception={(job?.reception as Reception | null) ?? null}
        isAdmin={role === "admin"}
        showCosts={!restricted}
        clientName={q.project.client.name}
      />
    </div>
  );
}
