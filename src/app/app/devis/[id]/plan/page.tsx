import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Notice } from "@/components/ui";
import { costAccess } from "@/lib/security/costs";
import { loadQuote } from "@/lib/quote/load";
import { loadRuleContext } from "@/lib/plans/rules.server";
import { LEVEL_LABELS } from "@/lib/quote/rooms";
import { sanitizeDraft } from "@/lib/plans/analysis";
import { planAnalysisEnabled } from "@/lib/plans/analyze.server";
import { PlanUpload } from "./PlanUpload";
import { PlanReview } from "./PlanReview";
import { LayoutEditor } from "./LayoutEditor";

export const metadata: Metadata = { title: "Plan" };
// Lecture du plan par l'IA : jusqu'à une minute
export const maxDuration = 300;

export default async function PlanPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ niveau?: string; mode?: string }> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const { supabase, db, companyId, company } = await costAccess();
  const q = await loadQuote(supabase, id);
  if (!q) notFound();
  const level = Math.min(5, Math.max(-1, Number.parseInt(sp.niveau ?? "0", 10) || 0));
  const mode = sp.mode === "implantation" ? "implantation" : "lecture";

  const [{ data: plans }, { data: quota }, { data: proj }] = await Promise.all([
    supabase.from("quote_plans").select("*").eq("quote_id", id).order("level"),
    supabase.rpc("ai_quota_status", { p_kind: "plan" }).maybeSingle<{ used: number; quota: number }>(),
    supabase.from("projects").select("total_area_m2").eq("id", q.project.id).single(),
  ]);
  const plan = (plans ?? []).find((p) => p.level === level) ?? null;
  const signed = plan ? (await supabase.storage.from("plans").createSignedUrl(plan.image_path, 3600)).data?.signedUrl ?? null : null;
  const levels = [...new Set([...(plans ?? []).map((p) => p.level as number), level])].sort((a, b) => a - b);
  const label = (l: number) => LEVEL_LABELS[l] ?? `Niveau ${l}`;

  // Contexte des règles (tous niveaux) : données techniques seulement, aucun prix
  const rules = mode === "implantation" ? await loadRuleContext(supabase, db, companyId, q, company.placement_rules) : null;
  const ruleContext = rules ? { plans: rules.plans, equipment: rules.equipment, tech: rules.tech, rooms: rules.rooms, settings: rules.settings } : null;

  const href = (l: number, m = mode) => `/app/devis/${id}/plan?niveau=${l}${m === "implantation" ? "&mode=implantation" : ""}`;
  return (
    <div className="space-y-6">
      <Link href={`/app/devis/${id}?etape=${mode === "implantation" ? 5 : 2}`} className="text-lg font-bold text-brand underline underline-offset-4">
        ← Retour au devis
      </Link>
      <h1 className="text-3xl font-extrabold">{mode === "implantation" ? "Implantation sur le plan" : "Plan du logement"}</h1>

      <nav className="flex flex-wrap gap-2" aria-label="Niveaux">
        {levels.map((l) => (
          <Link key={l} href={href(l)} aria-current={l === level ? "page" : undefined} className={`flex min-h-12 items-center rounded-xl border-2 px-4 text-base font-bold ${l === level ? "border-brand bg-brand text-white" : "border-slate-300 bg-white"}`}>
            {label(l)}
          </Link>
        ))}
        {mode === "lecture" &&
          [0, 1, 2, -1]
            .filter((l) => !levels.includes(l))
            .slice(0, 1)
            .map((l) => (
              <Link key={l} href={href(l)} className="flex min-h-12 items-center rounded-xl border-2 border-dashed border-brand px-4 text-base font-bold text-brand">
                + {label(l)}
              </Link>
            ))}
      </nav>

      {mode === "lecture" && (
        <>
          {!plan || !signed ? (
            <PlanUpload quoteId={id} companyId={companyId} level={level} levelLabel={label(level)} />
          ) : (
            <PlanReview
              key={plan.id + (plan.analyzed_at ?? "")}
              quoteId={id}
              level={level}
              imageUrl={signed}
              width={plan.width_px}
              height={plan.height_px}
              initialDraft={plan.draft ? sanitizeDraft(plan.draft, plan.width_px, plan.height_px) : null}
              declaredTotal={proj?.total_area_m2 === null || proj?.total_area_m2 === undefined ? null : Number(proj.total_area_m2)}
              quota={quota ? { used: Number(quota.used), quota: Number(quota.quota) } : null}
              aiEnabled={planAnalysisEnabled()}
              validatedAt={plan.validated_at}
            />
          )}
        </>
      )}

      {mode === "implantation" &&
        (!q.wizard.selection || !ruleContext ? (
          <Notice tone="danger">Choisissez d&apos;abord une solution (étape 4) : l&apos;implantation place le matériel retenu.</Notice>
        ) : !plan || !signed ? (
          <Notice>
            Pas encore de plan pour ce niveau.{" "}
            <Link className="font-bold underline" href={href(level, "lecture")}>
              Importer le plan
            </Link>
          </Notice>
        ) : (
          <LayoutEditor
            key={plan.id}
            quoteId={id}
            level={level}
            imageUrl={signed}
            width={plan.width_px}
            height={plan.height_px}
            northDeg={plan.north_deg === null ? null : Number(plan.north_deg)}
            context={ruleContext}
            quoteRooms={q.rooms.map((r) => ({ id: r.id, name: r.name }))}
            validatedAt={plan.layout_validated_at}
            quoteStatus={q.status}
          />
        ))}
    </div>
  );
}
