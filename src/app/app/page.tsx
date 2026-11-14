import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentCompany } from "@/lib/company/current";
import { formatEuros } from "@/lib/format";
import { LinkButton } from "@/components/ui";

const STATUS: Record<string, { label: string; cls: string }> = {
  brouillon: { label: "Brouillon", cls: "bg-slate-200 text-slate-800" },
  envoye: { label: "Envoyé", cls: "bg-brand-light text-brand-dark" },
  accepte: { label: "Accepté", cls: "bg-ok-light text-ok" },
  refuse: { label: "Refusé", cls: "bg-danger-light text-danger" },
};

export default async function AppHome() {
  const { supabase, company } = await getCurrentCompany();
  if (!company.onboarding_done) redirect("/app/bienvenue");
  const { data: quotes } = await supabase
    .from("quotes")
    .select("id, number, status, total_ttc_cents, net_margin_cents, issue_date, wizard, projects(clients(name))")
    .order("created_at", { ascending: false })
    .limit(50);
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-extrabold">Mes devis</h1>
      <LinkButton href="/app/devis/nouveau" full>
        + Nouveau devis
      </LinkButton>
      {(quotes ?? []).length === 0 && <p className="text-lg text-slate-700">Aucun devis pour l&apos;instant.</p>}
      <ul className="space-y-3">
        {(quotes ?? []).map((q) => {
          const client = (q.projects as unknown as { clients: { name: string } }).clients.name;
          const s = STATUS[q.status] ?? STATUS.brouillon!;
          const done = Number(q.total_ttc_cents) > 0;
          return (
            <li key={q.id}>
              <Link href={done ? `/app/devis/${q.id}/apercu` : `/app/devis/${q.id}`} className="block rounded-2xl border-2 border-slate-300 bg-white p-4 hover:border-brand">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-lg font-bold">
                    {q.number} · {client}
                  </p>
                  <span className={`rounded-md px-2 py-1 text-sm font-bold ${s.cls}`}>{s.label}</span>
                </div>
                <p className="text-base text-slate-700">
                  {done ? (
                    <>
                      {formatEuros(Number(q.total_ttc_cents), { decimals: false })} · marge {formatEuros(Number(q.net_margin_cents), { decimals: false })}
                    </>
                  ) : (
                    "En cours de chiffrage"
                  )}
                </p>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
