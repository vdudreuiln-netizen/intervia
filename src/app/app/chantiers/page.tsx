import type { Metadata } from "next";
import Link from "next/link";
import { Notice } from "@/components/ui";
import { formatEuros } from "@/lib/format";
import { costAccess } from "@/lib/security/costs";
import { JOB_STATUS_LABELS, type JobStatus } from "@/lib/site/site";

export const metadata: Metadata = { title: "Chantiers" };

/** Tous les chantiers (devis acceptés) : avancement et écarts en attente. */
export default async function SiteJobsPage() {
  const { supabase, db, companyId, restricted, role } = await costAccess();
  const { data: quotes } = await supabase
    .from("quotes")
    .select("id, number, decided_at, projects(site_city, clients(name))")
    .eq("company_id", companyId)
    .eq("status", "accepte")
    .order("decided_at", { ascending: false })
    .limit(100);
  const ids = (quotes ?? []).map((q) => q.id);
  const [{ data: jobs }, { data: devs }] = await Promise.all([
    ids.length ? supabase.from("site_jobs").select("quote_id, status, items_done, items_total, finished_at").in("quote_id", ids) : Promise.resolve({ data: [] }),
    ids.length ? supabase.from("site_deviations").select("id, quote_id, status").in("quote_id", ids).in("status", ["en_attente", "avenant_envoye"]) : Promise.resolve({ data: [] }),
  ]);
  // Surcoût en attente : membres autorisés seulement
  const pendingIds = (devs ?? []).filter((d) => d.status === "en_attente").map((d) => d.id);
  const { data: costs } = !restricted && pendingIds.length ? await db.from("site_deviation_costs").select("deviation_id, extra_purchase_cents").eq("company_id", companyId).in("deviation_id", pendingIds) : { data: [] };
  const costOf = new Map((costs ?? []).map((c) => [c.deviation_id, Number(c.extra_purchase_cents)]));
  const jobOf = new Map((jobs ?? []).map((j) => [j.quote_id, j]));

  const rows = (quotes ?? []).map((q) => {
    const j = jobOf.get(q.id);
    const mine = (devs ?? []).filter((d) => d.quote_id === q.id);
    const pending = mine.filter((d) => d.status === "en_attente");
    const p = q.projects as unknown as { site_city: string | null; clients: { name: string } | null } | null;
    return {
      id: q.id as string,
      number: q.number as string,
      client: p?.clients?.name ?? "",
      city: p?.site_city ?? "",
      status: (j?.status ?? "a_venir") as JobStatus,
      percent: j && j.items_total > 0 ? Math.round((j.items_done / j.items_total) * 100) : 0,
      pending: pending.length,
      sent: mine.length - pending.length,
      pendingCost: pending.reduce((s, d) => s + (costOf.get(d.id) ?? 0), 0),
    };
  });
  const order: Record<JobStatus, number> = { en_cours: 0, a_venir: 1, termine: 2 };
  rows.sort((a, b) => (b.pending > 0 ? 1 : 0) - (a.pending > 0 ? 1 : 0) || order[a.status] - order[b.status]);
  const totalPending = rows.reduce((s, r) => s + r.pending, 0);

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-extrabold">Chantiers</h1>
      {role === "admin" && totalPending > 0 && (
        <Notice tone="danger">
          {totalPending} écart{totalPending > 1 ? "s" : ""} en attente de votre décision{!restricted ? ` (surcoût d'achat : ${formatEuros(rows.reduce((s, r) => s + r.pendingCost, 0))})` : ""}.
        </Notice>
      )}
      {rows.length === 0 && <Notice>Aucun chantier pour l&apos;instant : un devis passe ici dès qu&apos;il est marqué « Accepté ».</Notice>}
      <ul className="space-y-3">
        {rows.map((r) => (
          <li key={r.id}>
            <Link href={`/app/chantiers/${r.id}`} className={`block rounded-2xl border-2 bg-white p-4 ${r.pending ? "border-danger" : "border-slate-300"}`}>
              <p className="text-xl font-extrabold">
                {r.client} <span className="text-base font-semibold text-slate-600">· {r.city}</span>
              </p>
              <p className="text-base">
                {r.number} · <strong>{JOB_STATUS_LABELS[r.status]}</strong>
                {r.status !== "a_venir" && ` · ${r.percent} % posé`}
              </p>
              {r.status !== "a_venir" && (
                <div className="mt-2 h-3 w-full overflow-hidden rounded-full bg-slate-200" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={r.percent} aria-label="Avancement de la pose">
                  <div className={`h-full ${r.status === "termine" ? "bg-ok" : "bg-brand"}`} style={{ width: `${r.status === "termine" ? 100 : r.percent}%` }} />
                </div>
              )}
              {r.pending > 0 && (
                <p className="mt-2 text-base font-bold text-danger">
                  {r.pending} écart{r.pending > 1 ? "s" : ""} en attente{!restricted && r.pendingCost > 0 ? ` · ${formatEuros(r.pendingCost)} de surcoût` : ""}
                </p>
              )}
              {r.sent > 0 && <p className="text-sm text-slate-600">{r.sent} avenant(s) en attente de réponse du client</p>}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
