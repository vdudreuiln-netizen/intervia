"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Choice, Field, LinkButton, Notice } from "@/components/ui";
import { formatEuros, formatPercent } from "@/lib/format";
import { dashboard, followUpMessage, monthLabel, needsFollowUp, type AmendmentSummary, type QuoteStatus, type QuoteSummary } from "@/lib/dashboard/stats";
import { deleteDraftQuote, duplicateQuote, recordFollowUp } from "./devis/actions";

export interface DashboardQuote extends QuoteSummary {
  number: string;
  totalTtcCents: number;
  issueDate: string;
  followUpCount: number;
  demo?: boolean;
  client: { name: string; phone: string | null; email: string | null };
}

type Filter = "tous" | QuoteStatus | "relancer";
const STATUS: Record<QuoteStatus, { label: string; cls: string }> = {
  brouillon: { label: "Brouillon", cls: "bg-slate-200 text-slate-800" },
  envoye: { label: "Envoyé", cls: "bg-brand-light text-brand-dark" },
  accepte: { label: "Accepté", cls: "bg-ok-light text-ok" },
  refuse: { label: "Refusé", cls: "bg-danger-light text-danger" },
};
const frDate = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function Trend({ value, points = false }: { value: number | null; points?: boolean }) {
  if (value === null) return <span className="text-sm text-slate-600">— vs mois précédent</span>;
  const up = value >= 0;
  const txt = points ? `${up ? "+" : ""}${Math.round(value * 100)} pts` : `${up ? "+" : ""}${formatPercent(value, 0)}`;
  return (
    <span className={`text-sm font-bold ${up ? "text-ok" : "text-danger"}`}>
      {up ? "▲" : "▼"} {txt} <span className="font-normal text-slate-600">vs mois précédent</span>
    </span>
  );
}

export function Dashboard({ quotes, amendments = [], followUpDays, vatRegime, company, nowIso, showMargin = true }: { quotes: DashboardQuote[]; amendments?: AmendmentSummary[]; followUpDays: number; vatRegime: "franchise" | "assujetti"; company: { name: string; phone: string | null }; nowIso: string; showMargin?: boolean }) {
  const now = useMemo(() => new Date(nowIso), [nowIso]);
  const d = useMemo(() => dashboard(quotes, now, followUpDays, amendments), [quotes, now, followUpDays, amendments]);
  const [filter, setFilter] = useState<Filter>("tous");
  const [q, setQ] = useState("");
  const toFollow = new Set(d.toFollowUp);

  const list = quotes.filter((x) => {
    if (filter === "relancer" ? !toFollow.has(x.id) : filter !== "tous" && x.status !== filter) return false;
    const words = norm(q).split(/\s+/).filter(Boolean);
    return words.every((w) => norm(`${x.number} ${x.client.name}`).includes(w));
  });
  const count = (f: Filter) => (f === "tous" ? quotes.length : f === "relancer" ? toFollow.size : quotes.filter((x) => x.status === f).length);
  const c = d.current;

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-3">
        <h1 className="text-3xl font-extrabold">Mes devis</h1>
        <span className="text-base font-semibold capitalize text-slate-600">{monthLabel(c.month)}</span>
      </div>
      <LinkButton href="/app/devis/nouveau" full>
        + Nouveau devis
      </LinkButton>

      <section className={`grid gap-3 ${showMargin ? "sm:grid-cols-3" : "sm:grid-cols-2"}`} aria-label="Indicateurs du mois">
        <div className="rounded-2xl border-2 border-slate-300 bg-white p-4">
          <p className="text-sm font-bold uppercase text-slate-600">CA signé HT</p>
          <p className="text-3xl font-extrabold">{formatEuros(c.signedHtCents, { decimals: false })}</p>
          <p className="text-sm text-slate-600">{c.acceptedCount} devis accepté(s)</p>
          {c.amendmentsCount > 0 && (
            <dl className="mt-1 grid grid-cols-2 text-sm">
              <dt className="text-slate-600">Montant initial</dt>
              <dd className="text-right">{formatEuros(c.initialHtCents, { decimals: false })}</dd>
              <dt className="text-slate-600">Avenants ({c.amendmentsCount})</dt>
              <dd className="text-right">{formatEuros(c.amendmentsHtCents, { decimals: false })}</dd>
              <dt className="font-bold">Total</dt>
              <dd className="text-right font-bold">{formatEuros(c.signedHtCents, { decimals: false })}</dd>
            </dl>
          )}
          <Trend value={d.changes.signedHt} />
        </div>
        {showMargin && <div className="rounded-2xl border-2 border-slate-300 bg-white p-4">
          <p className="text-sm font-bold uppercase text-slate-600">Marge nette signée</p>
          <p className="text-3xl font-extrabold">{formatEuros(c.signedMarginCents, { decimals: false })}</p>
          <p className="text-sm text-slate-600">{c.signedHtCents > 0 ? `${formatPercent(c.signedMarginCents / c.signedHtCents)} du CA` : "—"}</p>
          <Trend value={d.changes.signedMargin} />
        </div>}
        <div className="rounded-2xl border-2 border-slate-300 bg-white p-4">
          <p className="text-sm font-bold uppercase text-slate-600">Transformation</p>
          <p className="text-3xl font-extrabold">{c.conversionRate === null ? "—" : formatPercent(c.conversionRate, 0)}</p>
          <p className="text-sm text-slate-600">
            {c.sentCount ? `${Math.round((c.conversionRate ?? 0) * c.sentCount)} accepté(s) sur ${c.sentCount} envoyé(s) ce mois` : "Aucun devis envoyé ce mois"}
          </p>
          <Trend value={d.changes.conversionPoints} points />
        </div>
      </section>

      {toFollow.size > 0 && (
        <Notice tone="danger">
          {toFollow.size} devis envoyé(s) sans réponse depuis {followUpDays} jours ou plus.{" "}
          <button type="button" className="underline" onClick={() => setFilter("relancer")}>
            Les voir
          </button>
        </Notice>
      )}

      <Field label="Rechercher" value={q} onChange={setQ} type="search" placeholder="Nom du client ou n° de devis" />
      <div className="flex gap-2 overflow-x-auto pb-1" role="tablist">
        {(["tous", "brouillon", "envoye", "accepte", "refuse", "relancer"] as Filter[]).map((f) => (
          <button
            key={f}
            type="button"
            role="tab"
            aria-selected={filter === f}
            onClick={() => setFilter(f)}
            className={`min-h-12 shrink-0 rounded-full border-2 px-4 text-base font-bold ${filter === f ? "border-brand bg-brand text-white" : "border-slate-400 bg-white"}`}
          >
            {f === "tous" ? "Tous" : f === "relancer" ? "À relancer" : STATUS[f].label + "s"} ({count(f)})
          </button>
        ))}
      </div>

      {list.length === 0 && <p className="text-lg text-slate-700">{quotes.length === 0 ? "Aucun devis pour l'instant." : "Aucun devis ne correspond."}</p>}
      <ul className="space-y-3">
        {list.map((x) => (
          <QuoteCard key={x.id} quote={x} late={needsFollowUp(x, followUpDays, now)} vatRegime={vatRegime} company={company} showMargin={showMargin} />
        ))}
      </ul>
    </div>
  );
}

function QuoteCard({ quote: x, late, vatRegime, company, showMargin }: { quote: DashboardQuote; late: boolean; vatRegime: "franchise" | "assujetti"; company: { name: string; phone: string | null }; showMargin: boolean }) {
  const router = useRouter();
  const [dup, setDup] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const done = x.totalHtCents > 0;
  const s = STATUS[x.status];
  const amount = vatRegime === "franchise" ? `${formatEuros(x.totalHtCents, { decimals: false })} HT` : `${formatEuros(x.totalTtcCents, { decimals: false })} TTC`;

  async function followUp() {
    setMsg(null);
    const text = followUpMessage({ clientName: x.client.name, number: x.number, date: frDate(x.issueDate), amount, companyName: company.name, phone: company.phone });
    try {
      if (navigator.share) {
        await navigator.share({ title: `Devis ${x.number}`, text });
      } else {
        await navigator.clipboard?.writeText(text);
        const to = x.client.phone ? `sms:${x.client.phone.replace(/\s/g, "")}?&body=${encodeURIComponent(text)}` : x.client.email ? `mailto:${x.client.email}?subject=${encodeURIComponent(`Devis ${x.number}`)}&body=${encodeURIComponent(text)}` : null;
        if (to) window.location.href = to;
        else setMsg({ ok: true, text: "Message copié : collez-le dans votre messagerie." });
      }
    } catch (e) {
      if ((e as Error)?.name === "AbortError") return; // partage annulé : on ne note pas la relance
    }
    start(async () => {
      const r = await recordFollowUp(x.id);
      setMsg({ ok: r.ok, text: r.message ?? "" });
      if (r.ok) router.refresh();
    });
  }

  return (
    <li className={`rounded-2xl border-2 bg-white p-4 ${late ? "border-danger" : "border-slate-300"}`}>
      <Link href={done ? `/app/devis/${x.id}/apercu` : `/app/devis/${x.id}`} className="block">
        <div className="flex items-start justify-between gap-2">
          <p className="text-lg font-bold">
            {x.number} · {x.client.name}
          </p>
          <span className="flex shrink-0 flex-col items-end gap-1">
            <span className={`rounded-md px-2 py-1 text-sm font-bold ${s.cls}`}>{s.label}</span>
            {x.demo && <span className="rounded-md bg-amber-200 px-2 py-1 text-xs font-bold text-amber-900">DÉMONSTRATION</span>}
          </span>
        </div>
        <p className="text-base text-slate-700">
          {done ? (
            <>
              {amount}
              {showMargin && ` · marge ${formatEuros(x.netMarginCents, { decimals: false })}`}
            </>
          ) : (
            "En cours de chiffrage"
          )}
        </p>
        <p className="text-sm text-slate-600">
          Créé le {frDate(x.createdAt)}
          {x.sentAt && ` · envoyé le ${frDate(x.sentAt)}`}
          {x.lastFollowUpAt && ` · relancé le ${frDate(x.lastFollowUpAt)}${x.followUpCount > 1 ? ` (${x.followUpCount} fois)` : ""}`}
          {x.decidedAt && (x.status === "accepte" || x.status === "refuse") && ` · ${x.status === "accepte" ? "accepté" : "refusé"} le ${frDate(x.decidedAt)}`}
        </p>
        {late && <p className="mt-1 text-base font-bold text-danger">Sans réponse : à relancer</p>}
      </Link>
      <div className="mt-3 flex flex-wrap gap-2">
        {x.status === "envoye" && (
          <Button type="button" variant={late ? "primary" : "secondary"} disabled={pending} onClick={followUp}>
            Relancer
          </Button>
        )}
        <Button type="button" variant="secondary" onClick={() => setDup(!dup)}>
          Dupliquer
        </Button>
        {x.status === "brouillon" && (
          <Button
            type="button"
            variant="secondary"
            disabled={pending}
            onClick={() =>
              confirm(`Supprimer le brouillon ${x.number} ?`) &&
              start(async () => {
                const r = await deleteDraftQuote(x.id);
                setMsg({ ok: r.ok, text: r.message ?? "" });
                if (r.ok) router.refresh();
              })
            }
          >
            Supprimer
          </Button>
        )}
      </div>
      {dup && <DuplicateForm quoteId={x.id} clientName={x.client.name} onDone={(t) => setMsg(t)} />}
      {msg && (
        <div className="mt-3">
          <Notice tone={msg.ok ? "ok" : "danger"}>{msg.text}</Notice>
        </div>
      )}
    </li>
  );
}

function DuplicateForm({ quoteId, clientName, onDone }: { quoteId: string; clientName: string; onDone: (m: { ok: boolean; text: string }) => void }) {
  const router = useRouter();
  const [mode, setMode] = useState<"other" | "same">("other");
  const [name, setName] = useState("");
  const [pending, start] = useTransition();
  return (
    <div className="mt-3">
      <Card title="Dupliquer ce devis">
        <Choice
          label="Pour quel client ?"
          value={mode}
          onChange={setMode}
          options={[
            { value: "other", label: "Autre client", hint: "Même chiffrage, à adapter à un nouveau client et à son adresse" },
            { value: "same", label: `Même client (${clientName})`, hint: "Variante du devis pour le même chantier" },
          ]}
        />
        {mode === "other" && <Field label="Nom du nouveau client" value={name} onChange={setName} />}
        <p className="text-sm text-slate-600">Les prix sont recalculés avec votre catalogue actuel ; vos retouches manuelles sont conservées et les écarts vous seront signalés.</p>
        <Button
          type="button"
          full
          disabled={pending || (mode === "other" && !name.trim())}
          onClick={() =>
            start(async () => {
              const r = await duplicateQuote(quoteId, { mode, clientName: name });
              if (!r.ok || !r.next) return onDone({ ok: false, text: r.message ?? "Copie impossible." });
              router.push(r.next);
            })
          }
        >
          {pending ? "Copie en cours…" : "Créer la copie"}
        </Button>
      </Card>
    </div>
  );
}
