import { redirect } from "next/navigation";
import { getCurrentCompany } from "@/lib/company/current";
import { fetchAll } from "@/lib/catalog/queries";
import { Dashboard, type DashboardQuote } from "./Dashboard";

export default async function AppHome() {
  const { supabase, company, role, canSeeMargins } = await getCurrentCompany();
  if (!company.onboarding_done && role === "admin") redirect("/app/bienvenue");
  type Row = Record<string, unknown> & { projects: { clients: { name: string; phone: string | null; email: string | null } } };
  const rows = await fetchAll<Row>((from, to) =>
    supabase
      .from("quotes")
      .select("id, number, status, total_ht_cents, total_ttc_cents, notes, issue_date, created_at, sent_at, decided_at, last_follow_up_at, follow_up_count, projects(clients(name, phone, email))")
      .order("created_at", { ascending: false })
      .range(from, to) as never,
  );
  // Marges : table protégée, lue seulement par les membres autorisés
  const margins = new Map<string, number>();
  if (canSeeMargins) {
    const fin = await fetchAll<{ quote_id: string; net_margin_cents: number }>((from, to) => supabase.from("quote_financials").select("quote_id, net_margin_cents").range(from, to) as never);
    for (const f of fin) margins.set(f.quote_id, Number(f.net_margin_cents));
  }
  // Avenants acceptés : comptés dans le CA (le devis signé n'est jamais modifié)
  const { data: amRows } = await supabase.from("quote_amendments").select("quote_id, number, total_ht_cents, decided_at").eq("company_id", company.id).eq("status", "accepte");
  const amMargin = new Map<string, number>();
  if (canSeeMargins && amRows?.length) {
    const { data: devs } = await supabase.from("site_deviations").select("id, quote_id, amendment_number").eq("company_id", company.id).eq("status", "accepte");
    const { data: costs } = devs?.length ? await supabase.from("site_deviation_costs").select("deviation_id, margin_if_billed_cents").in("deviation_id", devs.map((d) => d.id)) : { data: [] };
    const byDev = new Map((costs ?? []).map((c) => [c.deviation_id as string, Number(c.margin_if_billed_cents)]));
    for (const d of devs ?? []) amMargin.set(`${d.quote_id}|${d.amendment_number}`, (amMargin.get(`${d.quote_id}|${d.amendment_number}`) ?? 0) + (byDev.get(d.id) ?? 0));
  }
  const amendments = (amRows ?? []).filter((a) => a.decided_at).map((a) => ({ quoteId: a.quote_id as string, totalHtCents: Number(a.total_ht_cents), marginCents: amMargin.get(`${a.quote_id}|${a.number}`) ?? 0, decidedAt: a.decided_at as string }));
  const quotes: DashboardQuote[] = rows.map((q) => ({
    id: q.id as string,
    number: q.number as string,
    status: q.status as DashboardQuote["status"],
    totalHtCents: Number(q.total_ht_cents),
    totalTtcCents: Number(q.total_ttc_cents),
    netMarginCents: margins.get(q.id as string) ?? 0,
    demo: typeof q.notes === "string" && (q.notes as string).startsWith("Devis de démonstration"),
    issueDate: q.issue_date as string,
    createdAt: q.created_at as string,
    sentAt: (q.sent_at as string | null) ?? null,
    decidedAt: (q.decided_at as string | null) ?? null,
    lastFollowUpAt: (q.last_follow_up_at as string | null) ?? null,
    followUpCount: Number(q.follow_up_count ?? 0),
    client: q.projects.clients,
  }));
  return <Dashboard quotes={quotes} amendments={amendments} followUpDays={Number(company.follow_up_days)} vatRegime={company.vat_regime} company={{ name: company.legal_name, phone: company.phone }} nowIso={new Date().toISOString()} showMargin={canSeeMargins} />;
}
