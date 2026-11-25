"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Field, MoneyField, Notice, Select } from "@/components/ui";
import { formatEuros, parseDecimal, parseEuros } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import {
  DEVIATION_LABELS,
  DEVIATION_STATUS_LABELS,
  JOB_STATUS_LABELS,
  progress,
  RECEPTION_LEGAL,
  type Checks,
  type CommissioningCheck,
  type CommissioningSection,
  type DeviationKind,
  type DeviationStatus,
  type JobStatus,
  type Reception,
  type SiteItem,
  type Values,
} from "@/lib/site/site";
import { canvasToJpeg, imageFileToCanvas } from "../../devis/[id]/plan/PlanUpload";
import { PlanCanvas, unit } from "../../devis/[id]/plan/PlanCanvas";
import { addPhoto, decideAmendment, decideDeviations, deletePhoto, priceDeviation, reportDeviation, saveCommissioning, saveReception, setCheck } from "../actions";

export interface PlanView {
  level: number;
  label: string;
  url: string;
  width: number;
  height: number;
}
export interface PhotoView {
  id: string;
  url: string;
  elementId: string | null;
  level: number | null;
  x: number | null;
  y: number | null;
  kind: string;
  caption: string | null;
}
export interface DeviationView {
  id: string;
  kind: DeviationKind;
  description: string;
  quantity: number | null;
  status: DeviationStatus;
  amendment: number | null;
  createdAt: string;
  costs: { priced: boolean; extraPurchaseCents: number; extraSaleCents: number; marginIfBilledCents: number; marginIfAbsorbedCents: number; lines: { designation: string; quantity: number; unit: string; unitPurchaseCents: number; unitSaleCents: number }[] } | null;
}
export interface AmendmentView {
  number: number;
  status: "envoye" | "accepte" | "refuse";
  totalHtCents: number;
  totalTtcCents: number;
}

interface Props {
  quoteId: string;
  companyId: string;
  status: JobStatus;
  plans: PlanView[];
  items: SiteItem[];
  checks: Checks;
  photos: PhotoView[];
  deviations: DeviationView[];
  amendments: AmendmentView[];
  quoteTotals: { htCents: number; ttcCents: number };
  indoors: { key: string; label: string }[];
  accessories: { id: string; label: string }[];
  sections: CommissioningSection[];
  values: Values;
  commissioningCheck: CommissioningCheck;
  reception: Reception | null;
  isAdmin: boolean;
  showCosts: boolean;
  clientName: string;
}

type Tab = "pose" | "photos" | "ecarts" | "mes" | "reception";
const PHOTO_KINDS: Record<string, string> = { avant: "Avant", apres: "Après", passage: "Passage de mur", etiquette: "Étiquette / n° de série", autre: "Autre" };
type Msg = { ok: boolean; text: string } | null;

export function SiteJob(p: Props) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("pose");
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; message?: string }>, then?: () => void) =>
    start(async () => {
      const r = await fn();
      setMsg(r.ok ? (r.message ? { ok: true, text: r.message } : null) : { ok: false, text: r.message ?? "Erreur." });
      if (r.ok) {
        then?.();
        router.refresh();
      }
    });
  const prog = progress(p.items, p.checks);
  const pending = p.deviations.filter((d) => d.status === "en_attente").length;
  const tabs: [Tab, string][] = [
    ["pose", `Pose ${prog.percent} %`],
    ["photos", `Photos (${p.photos.length})`],
    ["ecarts", `Écarts${pending ? ` (${pending})` : ""}`],
    ["mes", "Mise en service"],
    ["reception", "Réception"],
  ];
  return (
    <div className="space-y-5">
      <p className="text-lg">
        Statut : <strong>{JOB_STATUS_LABELS[p.status]}</strong> · {prog.done} / {prog.total} éléments posés
      </p>
      <nav className="flex gap-2 overflow-x-auto pb-1" aria-label="Sections du chantier">
        {tabs.map(([t, label]) => (
          <button key={t} type="button" onClick={() => (setTab(t), setMsg(null))} aria-current={tab === t ? "page" : undefined} className={`min-h-12 shrink-0 rounded-xl border-2 px-4 text-base font-bold ${tab === t ? "border-brand bg-brand text-white" : "border-slate-300 bg-white"}`}>
            {label}
          </button>
        ))}
      </nav>
      {msg && <Notice tone={msg.ok ? "ok" : "danger"}>{msg.text}</Notice>}
      {tab === "pose" && <Pose {...p} busy={busy} run={run} />}
      {tab === "photos" && <Photos {...p} busy={busy} run={run} setMsg={setMsg} />}
      {tab === "ecarts" && <Deviations {...p} busy={busy} run={run} />}
      {tab === "mes" && <Commissioning {...p} busy={busy} run={run} />}
      {tab === "reception" && <ReceptionTab {...p} busy={busy} run={run} setMsg={setMsg} />}
    </div>
  );
}

type Run = (fn: () => Promise<{ ok: boolean; message?: string }>, then?: () => void) => void;
type Sub = Props & { busy: boolean; run: Run };

// ---------------------------------------------------------------------------
// 1. Pose : plan + éléments à cocher
// ---------------------------------------------------------------------------
function Pose({ quoteId, plans, items, checks, photos, busy, run }: Sub) {
  const [level, setLevel] = useState(plans[0]?.level ?? 0);
  const plan = plans.find((x) => x.level === level);
  const toggle = (it: SiteItem) => run(() => setCheck(quoteId, it.id, !checks[it.id], items.length));
  const groups = [...new Set(items.map((i) => i.group))];
  return (
    <div className="space-y-5">
      {plans.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {plans.map((pl) => (
            <button key={pl.level} type="button" onClick={() => setLevel(pl.level)} className={`min-h-11 rounded-lg border-2 px-3 text-sm font-bold ${pl.level === level ? "border-brand bg-brand text-white" : "border-slate-300 bg-white"}`}>
              {pl.label}
            </button>
          ))}
        </div>
      )}
      {plan ? (
        <PlanCanvas imageUrl={plan.url} width={plan.width} height={plan.height}>
          {items
            .filter((i) => i.level === level && i.x !== null)
            .map((i) => {
              const u = unit(plan.width, plan.height);
              const on = Boolean(checks[i.id]);
              return (
                <g key={i.id} onClick={(e) => (e.stopPropagation(), !busy && toggle(i))} style={{ cursor: "pointer" }} role="checkbox" aria-checked={on} aria-label={i.label}>
                  <circle cx={i.x!} cy={i.y!} r={u * 2.8} fill={on ? "#16A34A" : "white"} stroke={on ? "#14532D" : "#B91C1C"} strokeWidth={u * 0.5} />
                  <text x={i.x!} y={i.y! + u * 0.9} fontSize={u * 2.4} textAnchor="middle" fontWeight="bold" fill={on ? "white" : "#B91C1C"} pointerEvents="none">
                    {on ? "✓" : i.label.split(" ")[0]!.slice(0, 2)}
                  </text>
                </g>
              );
            })}
          {photos
            .filter((ph) => ph.level === level && ph.x !== null)
            .map((ph) => {
              const u = unit(plan.width, plan.height);
              return (
                <text key={ph.id} x={ph.x! + u * 2.5} y={ph.y! - u * 2} fontSize={u * 2.6} pointerEvents="none">
                  📷
                </text>
              );
            })}
        </PlanCanvas>
      ) : (
        <Notice>Pas de plan d&apos;implantation pour ce chantier : cochez les éléments dans la liste.</Notice>
      )}
      <p className="text-sm text-slate-600">Touchez un repère du plan ou une ligne pour le cocher. Rouge : à faire ; vert : posé.</p>
      {groups.map((g) => (
        <Card key={g} title={g}>
          {items
            .filter((i) => i.group === g)
            .map((i) => (
              <label key={i.id} className="flex min-h-12 items-center gap-3 text-lg">
                <input type="checkbox" className="h-7 w-7" checked={Boolean(checks[i.id])} disabled={busy} onChange={() => toggle(i)} />
                <span className={checks[i.id] ? "text-slate-500 line-through" : ""}>{i.label}</span>
              </label>
            ))}
        </Card>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 2. Photos placées sur le plan
// ---------------------------------------------------------------------------
function Photos({ quoteId, companyId, items, photos, busy, run, setMsg }: Sub & { setMsg: (m: Msg) => void }) {
  const [element, setElement] = useState("");
  const [kind, setKind] = useState("apres");
  const [caption, setCaption] = useState("");
  const [sending, setSending] = useState(false);
  async function upload(f: File) {
    setSending(true);
    setMsg(null);
    try {
      const blob = await canvasToJpeg(await imageFileToCanvas(f));
      const path = `${companyId}/${quoteId}/photo-${Date.now()}.jpg`;
      const { error } = await createClient().storage.from("chantier").upload(path, blob, { contentType: "image/jpeg" });
      if (error) throw new Error();
      const it = items.find((i) => i.id === element);
      run(() => addPhoto(quoteId, { path, elementId: it?.id ?? null, level: it?.level ?? null, x: it?.x ?? null, y: it?.y ?? null, kind, caption }), () => setCaption(""));
    } catch {
      setMsg({ ok: false, text: "Envoi de la photo impossible. Vérifiez votre connexion." });
    } finally {
      setSending(false);
    }
  }
  const label = (id: string | null) => items.find((i) => i.id === id)?.label.split(" – ")[0] ?? "Général";
  return (
    <div className="space-y-5">
      <Card title="Ajouter une photo">
        <Select label="Élément photographié" value={element} onChange={setElement} options={items.map((i) => ({ value: i.id, label: i.label }))} placeholder="Général (pas sur le plan)" hint="La photo se place sur le plan à l'endroit de l'élément" />
        <Select label="Type" value={kind} onChange={setKind} options={Object.entries(PHOTO_KINDS).map(([value, l]) => ({ value, label: l }))} />
        <Field label="Légende" value={caption} onChange={setCaption} placeholder="Ex. : n° de série E1, passage du mur nord" />
        <label className="flex min-h-16 cursor-pointer items-center justify-center rounded-xl bg-brand px-4 text-center text-lg font-bold text-white">
          {sending || busy ? "Envoi…" : "📷 Prendre / choisir la photo"}
          <input type="file" accept="image/*" capture="environment" className="sr-only" disabled={sending || busy} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
        </label>
      </Card>
      {photos.length === 0 ? (
        <Notice>Aucune photo. Pensez aux étiquettes des appareils (numéros de série), aux passages de murs et à l&apos;avant / après.</Notice>
      ) : (
        <ul className="grid grid-cols-2 gap-3">
          {photos.map((ph) => (
            <li key={ph.id} className="overflow-hidden rounded-xl border-2 border-slate-300 bg-white">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={ph.url} alt={ph.caption ?? PHOTO_KINDS[ph.kind] ?? "Photo du chantier"} className="aspect-square w-full object-cover" loading="lazy" />
              <div className="p-2 text-sm">
                <p className="font-bold">
                  {label(ph.elementId)} · {PHOTO_KINDS[ph.kind] ?? ph.kind}
                </p>
                {ph.caption && <p>{ph.caption}</p>}
                <button type="button" className="font-bold text-danger underline" disabled={busy} onClick={() => confirm("Supprimer cette photo ?") && run(() => deletePhoto(quoteId, ph.id))}>
                  Supprimer
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 3. Écarts avec le prévu
// ---------------------------------------------------------------------------
function Deviations({ quoteId, deviations, amendments, quoteTotals, indoors, accessories, isAdmin, showCosts, busy, run }: Sub) {
  const [kind, setKind] = useState<DeviationKind>("longueur");
  const [key, setKey] = useState(indoors[0]?.key ?? "");
  const [qty, setQty] = useState("");
  const [acc, setAcc] = useState("");
  const [desc, setDesc] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [price, setPrice] = useState<Record<string, { sale: string; cost: string }>>({});
  const needsUnit = kind === "longueur" || kind === "pompe";
  const needsQty = kind !== "pompe" && kind !== "autre";
  const auto = kind === "longueur" ? `Liaison ${qty || "?"} m plus longue (${indoors.find((i) => i.key === key)?.label.split(" – ")[0] ?? ""})` : kind === "pompe" ? `Pompe de relevage nécessaire (${indoors.find((i) => i.key === key)?.label.split(" – ")[0] ?? ""})` : "";
  const pendingList = deviations.filter((d) => d.status === "en_attente");
  const euro = (c: number) => `${c > 0 ? "+" : ""}${formatEuros(c)}`;
  return (
    <div className="space-y-5">
      <Card title="Signaler un écart avec le prévu">
        <Select label="Type d'écart" value={kind} onChange={(v) => setKind(v as DeviationKind)} options={Object.entries(DEVIATION_LABELS).map(([value, label]) => ({ value, label }))} />
        {needsUnit && <Select label="Unité concernée" value={key} onChange={setKey} options={indoors.map((i) => ({ value: i.key, label: i.label }))} />}
        {needsQty && <Field label={kind === "longueur" ? "Longueur en plus" : "Quantité"} inputMode="decimal" suffix={kind === "longueur" ? "m" : undefined} value={qty} onChange={setQty} />}
        {(kind === "carottage" || kind === "materiel") && <Select label="Article du catalogue (pour le chiffrage)" value={acc} onChange={setAcc} options={accessories.map((a) => ({ value: a.id, label: a.label }))} placeholder="Pas dans le catalogue (l'administrateur chiffrera)" />}
        <Field label="Description" value={desc} onChange={setDesc} placeholder={auto || "Ex. : mur en béton banché, carottage Ø 60 en plus"} hint="Ce texte figurera sur l'avenant envoyé au client" />
        <Button type="button" full disabled={busy} onClick={() => run(() => reportDeviation(quoteId, { kind, equipmentKey: needsUnit ? key : null, quantity: needsQty ? parseDecimal(qty) : null, accessoryId: acc || null, description: desc.trim() || auto, elementId: null }), () => (setQty(""), setDesc("")))}>
          {busy ? "Envoi…" : "Transmettre à l'administrateur"}
        </Button>
        {!isAdmin && <p className="text-sm text-slate-600">Le surcoût est calculé automatiquement ; l&apos;administrateur décide de l&apos;avenant.</p>}
      </Card>

      {deviations.length > 0 && (
        <Card title="Écarts signalés">
          <ul className="space-y-3">
            {deviations.map((d) => (
              <li key={d.id} className={`rounded-xl border-2 p-3 ${d.status === "en_attente" ? "border-danger" : "border-slate-300"}`}>
                <label className="flex items-start gap-3 text-base">
                  {isAdmin && d.status === "en_attente" && <input type="checkbox" className="mt-1 h-6 w-6" checked={picked.includes(d.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, d.id] : picked.filter((x) => x !== d.id))} />}
                  <span>
                    <strong>{d.description}</strong>
                    <span className="block text-sm text-slate-600">
                      {DEVIATION_LABELS[d.kind]} · {new Date(d.createdAt).toLocaleDateString("fr-FR")} · {DEVIATION_STATUS_LABELS[d.status]}
                      {d.amendment ? ` (avenant n° ${d.amendment})` : ""}
                    </span>
                  </span>
                </label>
                {showCosts && d.costs?.priced && (
                  <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                    <dt className="text-slate-600">Surcoût d&apos;achat</dt>
                    <dd className="text-right font-bold">{formatEuros(d.costs.extraPurchaseCents)}</dd>
                    <dt className="text-slate-600">Prix de l&apos;avenant HT</dt>
                    <dd className="text-right font-bold">{formatEuros(d.costs.extraSaleCents)}</dd>
                    <dt className="text-slate-600">Marge si facturé</dt>
                    <dd className="text-right font-bold text-ok">{euro(d.costs.marginIfBilledCents)}</dd>
                    <dt className="text-slate-600">Marge si absorbé</dt>
                    <dd className="text-right font-bold text-danger">{euro(d.costs.marginIfAbsorbedCents)}</dd>
                  </dl>
                )}
                {showCosts && d.costs?.priced && (
                  <table className="mt-2 w-full text-xs">
                    <thead>
                      <tr className="text-left text-slate-600">
                        <th className="font-semibold">Ligne</th>
                        <th className="text-right font-semibold">Vente</th>
                        <th className="text-right font-semibold">Coût</th>
                        <th className="text-right font-semibold">Marge</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.costs.lines.map((l, i) => {
                        const sale = Math.round(l.quantity * l.unitSaleCents);
                        const cost = Math.round(l.quantity * l.unitPurchaseCents);
                        return (
                          <tr key={i} className="border-t border-slate-200">
                            <td>
                              {l.designation} × {l.quantity.toLocaleString("fr-FR")} {l.unit}
                            </td>
                            <td className="text-right">{formatEuros(sale)}</td>
                            <td className="text-right">{formatEuros(cost)}</td>
                            <td className={`text-right font-bold ${sale - cost < 0 ? "text-danger" : "text-ok"}`}>{formatEuros(sale - cost)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
                {isAdmin && d.status === "en_attente" && !d.costs?.priced && (
                  <div className="mt-2 grid grid-cols-[1fr_1fr_auto] items-end gap-2">
                    <MoneyField label="Prix HT" value={price[d.id]?.sale ?? ""} onChange={(v) => setPrice({ ...price, [d.id]: { sale: v, cost: price[d.id]?.cost ?? "" } })} />
                    <MoneyField label="Coût" value={price[d.id]?.cost ?? ""} onChange={(v) => setPrice({ ...price, [d.id]: { cost: v, sale: price[d.id]?.sale ?? "" } })} />
                    <Button type="button" variant="secondary" disabled={busy} onClick={() => run(() => priceDeviation(quoteId, d.id, parseEuros(price[d.id]?.sale ?? "") ?? -1, parseEuros(price[d.id]?.cost ?? "") ?? 0))}>
                      Chiffrer
                    </Button>
                  </div>
                )}
                {isAdmin && (d.status === "absorbe" || d.status === "refuse") && (
                  <button type="button" className="mt-2 text-sm font-bold text-brand underline" disabled={busy} onClick={() => run(() => decideDeviations(quoteId, [d.id], "en_attente"))}>
                    Remettre en attente
                  </button>
                )}
              </li>
            ))}
          </ul>
          {isAdmin && pendingList.length > 0 && (
            <div className="grid gap-2 sm:grid-cols-2">
              <Button type="button" disabled={busy || picked.length === 0} onClick={() => run(() => decideDeviations(quoteId, picked, "avenant"), () => setPicked([]))}>
                Préparer l&apos;avenant ({picked.length})
              </Button>
              <Button type="button" variant="secondary" disabled={busy || picked.length === 0} onClick={() => run(() => decideDeviations(quoteId, picked, "absorbe"), () => setPicked([]))}>
                Prendre à notre charge
              </Button>
            </div>
          )}
        </Card>
      )}

      {amendments.length > 0 && (
        <Card title="Avenants">
          <dl className="grid grid-cols-2 gap-y-1 text-base">
            <dt>Montant initial du devis</dt>
            <dd className="text-right font-bold">{formatEuros(quoteTotals.htCents)} HT</dd>
            <dt>Avenants acceptés</dt>
            <dd className="text-right font-bold">{formatEuros(amendments.filter((a) => a.status === "accepte").reduce((n, a) => n + a.totalHtCents, 0))} HT</dd>
            <dt className="font-bold">Total du marché</dt>
            <dd className="text-right text-lg font-extrabold">{formatEuros(quoteTotals.htCents + amendments.filter((a) => a.status === "accepte").reduce((n, a) => n + a.totalHtCents, 0))} HT</dd>
          </dl>
          <ul className="space-y-3">
            {amendments.map((a) => (
              <li key={a.number} className="rounded-xl border-2 border-slate-300 p-3">
                <p className="text-base">
                  <strong>Avenant n° {a.number}</strong> · {formatEuros(a.totalHtCents)} HT ({formatEuros(a.totalTtcCents)} TTC) ·{" "}
                  <span className={a.status === "accepte" ? "font-bold text-ok" : a.status === "refuse" ? "font-bold text-danger" : ""}>{a.status === "envoye" ? "envoyé, en attente de réponse" : a.status === "accepte" ? "accepté" : "refusé"}</span>
                </p>
                <a href={`/app/chantiers/${quoteId}/avenant/${a.number}`} target="_blank" rel="noopener" className="mt-2 flex min-h-12 items-center justify-center rounded-xl border-2 border-brand bg-white px-4 text-base font-bold text-brand">
                  PDF de l&apos;avenant
                </a>
                {isAdmin && a.status === "envoye" && (
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <Button type="button" disabled={busy} onClick={() => run(() => decideAmendment(quoteId, a.number, "accepte"))}>
                      Accepté par le client
                    </Button>
                    <Button type="button" variant="secondary" disabled={busy} onClick={() => run(() => decideAmendment(quoteId, a.number, "refuse"))}>
                      Refusé
                    </Button>
                    <button type="button" className="col-span-2 text-sm font-bold text-brand underline" disabled={busy} onClick={() => confirm("Annuler cet avenant et remettre ses écarts en attente ?") && run(() => decideAmendment(quoteId, a.number, "annule"))}>
                      Annuler l&apos;avenant
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 4. Mise en service + fiche fluides
// ---------------------------------------------------------------------------
function Commissioning({ quoteId, sections, values, commissioningCheck: chk, busy, run }: Sub) {
  const [v, setV] = useState<Values>(values);
  const set = (id: string, val: string) => setV({ ...v, [id]: val });
  return (
    <div className="space-y-5">
      {chk.errors.map((e) => (
        <Notice key={e} tone="danger">
          ⛔ {e}
        </Notice>
      ))}
      {chk.warnings.map((w) => (
        <Notice key={w}>⚠ {w}</Notice>
      ))}
      {sections.map((s) => (
        <Card key={s.title} title={s.title}>
          {s.fields.map((f) =>
            f.type === "bool" ? (
              <div key={f.id}>
                <p className="mb-1 text-base font-bold">
                  {f.label}
                  {f.required ? " *" : ""}
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {["oui", "non"].map((o) => (
                    <button key={o} type="button" onClick={() => set(f.id, o)} aria-pressed={v[f.id] === o} className={`min-h-12 rounded-xl border-2 text-lg font-bold ${v[f.id] === o ? (o === "oui" ? "border-ok bg-ok text-white" : "border-danger bg-danger text-white") : "border-slate-300 bg-white"}`}>
                      {o === "oui" ? "Oui" : "Non"}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <Field key={f.id} label={`${f.label}${f.required ? " *" : ""}`} type={f.type === "date" ? "date" : "text"} inputMode={f.type === "number" ? "decimal" : undefined} suffix={f.unit} value={v[f.id] ?? ""} onChange={(val) => set(f.id, val)} hint={f.hint} />
            ),
          )}
        </Card>
      ))}
      <Button type="button" full disabled={busy} onClick={() => run(() => saveCommissioning(quoteId, v))}>
        {busy ? "Enregistrement…" : "Enregistrer les relevés"}
      </Button>
      {chk.missing.length > 0 ? (
        <Notice>
          Reste à renseigner : {chk.missing.slice(0, 6).join(" ; ")}
          {chk.missing.length > 6 ? `… (+${chk.missing.length - 6})` : ""}
        </Notice>
      ) : (
        chk.complete && <Notice tone="ok">Mise en service complète ✔</Notice>
      )}
      <a href={`/app/chantiers/${quoteId}/fluides`} target="_blank" rel="noopener" className="flex min-h-14 items-center justify-center rounded-xl border-2 border-brand bg-white px-4 text-center text-lg font-bold text-brand">
        Fiche fluides préremplie (PDF)
      </a>
      <p className="text-sm text-slate-600">Données à reporter sur le CERFA 15497*04 (charge totale, tonnage équivalent CO2, contrôle d&apos;étanchéité), à signer par l&apos;opérateur et le client.</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 5. Réception signée par le client
// ---------------------------------------------------------------------------
function ReceptionTab({ quoteId, companyId, reception, clientName, commissioningCheck, busy, run, setMsg }: Sub & { setMsg: (m: Msg) => void }) {
  const [name, setName] = useState(reception?.signerName ?? clientName);
  const [reserves, setReserves] = useState<string[]>(reception?.reserves ?? []);
  const [draft, setDraft] = useState("");
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [signed, setSigned] = useState(false);
  const [sending, setSending] = useState(false);

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = canvas.current!;
    const r = c.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * c.width, y: ((e.clientY - r.top) / r.height) * c.height };
  };
  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const ctx = canvas.current!.getContext("2d")!;
    drawing.current = true;
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#111827";
    const p0 = pos(e);
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = canvas.current!.getContext("2d")!;
    const p1 = pos(e);
    ctx.lineTo(p1.x, p1.y);
    ctx.stroke();
    setSigned(true);
  };
  const clear = () => {
    const c = canvas.current!;
    c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
    setSigned(false);
  };

  async function submit() {
    if (!signed) return setMsg({ ok: false, text: "La signature du client est nécessaire." });
    setSending(true);
    try {
      const blob = await new Promise<Blob | null>((res) => canvas.current!.toBlob(res, "image/png"));
      if (!blob) throw new Error();
      const path = `${companyId}/${quoteId}/signature-${Date.now()}.png`;
      const { error } = await createClient().storage.from("chantier").upload(path, blob, { contentType: "image/png" });
      if (error) throw new Error();
      run(() => saveReception(quoteId, { signerName: name, reserves, signaturePath: path }));
    } catch {
      setMsg({ ok: false, text: "Envoi de la signature impossible. Vérifiez votre connexion." });
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-5">
      {reception && (
        <Notice tone="ok">
          Réception signée par {reception.signerName} le {new Date(reception.signedAt).toLocaleDateString("fr-FR")}
          {reception.reserves.length ? `, avec ${reception.reserves.length} réserve(s)` : ", sans réserve"}.
        </Notice>
      )}
      {reception && (
        <a href={`/app/chantiers/${quoteId}/pv`} target="_blank" rel="noopener" className="flex min-h-14 items-center justify-center rounded-xl bg-brand px-4 text-lg font-bold text-white">
          Procès-verbal de réception (PDF avec photos)
        </a>
      )}
      {!commissioningCheck.complete && <Notice>La mise en service n&apos;est pas complète : terminez-la avant de faire signer la réception.</Notice>}
      <Card title={reception ? "Refaire signer la réception" : "Procès-verbal de réception"}>
        <p className="text-sm text-slate-600">{RECEPTION_LEGAL}</p>
        <div>
          <p className="text-base font-bold">Réserves éventuelles</p>
          {reserves.length === 0 && <p className="text-base text-slate-600">Aucune : réception sans réserve.</p>}
          <ul className="space-y-1">
            {reserves.map((r, i) => (
              <li key={i} className="flex items-start justify-between gap-2 text-base">
                <span>• {r}</span>
                <button type="button" className="font-bold text-danger underline" onClick={() => setReserves(reserves.filter((_, j) => j !== i))}>
                  Retirer
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-2 grid grid-cols-[1fr_auto] items-end gap-2">
            <Field label="Ajouter une réserve" value={draft} onChange={setDraft} placeholder="Ex. : retouche de peinture autour de la goulotte" />
            <Button type="button" variant="secondary" disabled={draft.trim().length < 3} onClick={() => (setReserves([...reserves, draft.trim()]), setDraft(""))}>
              Ajouter
            </Button>
          </div>
        </div>
        <Field label="Nom du signataire (client)" value={name} onChange={setName} />
        <div>
          <p className="mb-1 text-base font-bold">Signature du client</p>
          <canvas ref={canvas} width={900} height={320} className="w-full touch-none rounded-xl border-2 border-slate-400 bg-white" onPointerDown={down} onPointerMove={move} onPointerUp={() => (drawing.current = false)} onPointerLeave={() => (drawing.current = false)} aria-label="Zone de signature" />
          <button type="button" className="mt-1 text-base font-bold text-brand underline" onClick={clear}>
            Effacer
          </button>
        </div>
        <Button type="button" full disabled={busy || sending} onClick={submit}>
          {busy || sending ? "Enregistrement…" : "Valider la réception"}
        </Button>
      </Card>
    </div>
  );
}
