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
      .select("id, number, status, total_ht_cents, total_ttc_cents, net_margin_cents, issue_date, created_at, sent_at, decided_at, last_follow_up_at, follow_up_count, projects(clients(name, phone, email))")
      .order("created_at", { ascending: false })
      .range(from, to) as never,
  );
  const quotes: DashboardQuote[] = rows.map((q) => ({
    id: q.id as string,
    number: q.number as string,
    status: q.status as DashboardQuote["status"],
    totalHtCents: Number(q.total_ht_cents),
    totalTtcCents: Number(q.total_ttc_cents),
    netMarginCents: Number(q.net_margin_cents),
    issueDate: q.issue_date as string,
    createdAt: q.created_at as string,
    sentAt: (q.sent_at as string | null) ?? null,
    decidedAt: (q.decided_at as string | null) ?? null,
    lastFollowUpAt: (q.last_follow_up_at as string | null) ?? null,
    followUpCount: Number(q.follow_up_count ?? 0),
    client: q.projects.clients,
  }));
  return <Dashboard quotes={quotes} followUpDays={Number(company.follow_up_days)} vatRegime={company.vat_regime} company={{ name: company.legal_name, phone: company.phone }} nowIso={new Date().toISOString()} showMargin={canSeeMargins} />;
}
