"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Field, Notice, Select } from "@/components/ui";
import { decimalToInput, parseDecimal } from "@/lib/format";
import { draftScale, draftTotalArea, emptyDraft, proposeRooms, roomArea, windowWidth, type DraftRoom, type PlanDraft, type WindowKind } from "@/lib/plans/analysis";
import { centroid, checkTotalArea, SCALE_LABELS, type Pt } from "@/lib/plans/geometry";
import { INSULATION_LABELS, ORIENTATION_LABELS, type Insulation, type Orientation } from "@/lib/sizing/sizing";
import { LEVEL_LABELS } from "@/lib/quote/rooms";
import type { IndoorChoice } from "@/lib/quote/types";
import { analyzePlan, applyPlanRooms, deletePlan, saveDraft, type PlanRoomInput } from "./actions";
import { NorthArrow, PlanCanvas, unit } from "./PlanCanvas";

type Tool = "none" | "measure" | "room" | "window";
const WINDOW_LABELS: Record<WindowKind, string> = { fenetre: "Fenêtre", porte_fenetre: "Porte-fenêtre", baie_vitree: "Baie vitrée" };
const INDOOR_LABELS: Record<IndoorChoice, string> = { mural: "Murale", console: "Console", cassette: "Cassette" };
const COLORS = ["#0B4F8A", "#0E7490", "#7C3AED", "#B45309", "#15803D", "#BE185D", "#4338CA", "#A16207"];
const m2 = (n: number | null) => (n === null ? "?" : `${n.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} m²`);

interface Props {
  quoteId: string;
  level: number;
  imageUrl: string;
  width: number;
  height: number;
  initialDraft: PlanDraft | null;
  declaredTotal: number | null;
  quota: { used: number; quota: number } | null;
  aiEnabled: boolean;
  validatedAt: string | null;
}

export function PlanReview({ quoteId, level, imageUrl, width, height, initialDraft, declaredTotal, quota, aiEnabled, validatedAt }: Props) {
  const router = useRouter();
  const [draft, setDraft] = useState<PlanDraft | null>(initialDraft ? { ...initialDraft, declaredTotalM2: initialDraft.declaredTotalM2 ?? declaredTotal } : null);
  const [tool, setTool] = useState<Tool>("none");
  const [pending, setPending] = useState<Pt[]>([]);
  const [measureLen, setMeasureLen] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, start] = useTransition();
  const [step, setStep] = useState<"plan" | "rooms">("plan");
  const u = unit(width, height);

  const scale = draft ? draftScale(draft) : null;
  const total = draft ? draftTotalArea(draft) : null;
  const totalCheck = draft && total !== null ? checkTotalArea(total, draft.declaredTotalM2) : null;
  const update = (patch: Partial<PlanDraft>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const updateRoom = (id: string, patch: Partial<DraftRoom>) => setDraft((d) => (d ? { ...d, rooms: d.rooms.map((r) => (r.id === id ? { ...r, ...patch } : r)) } : d));

  function onPoint(p: Pt) {
    if (!draft) return;
    if (tool === "measure") {
      const pts = [...pending, p].slice(-2);
      setPending(pts);
    } else if (tool === "room") setPending([...pending, p]);
    else if (tool === "window" && selected) {
      const pts = [...pending, p];
      if (pts.length === 2) {
        const room = draft.rooms.find((r) => r.id === selected)!;
        updateRoom(selected, { windows: [...room.windows, { id: `w${Date.now()}`, a: pts[0]!, b: pts[1]!, kind: "fenetre", widthM: null }] });
        setPending([]);
      } else setPending(pts);
    } else {
      // sélection de la pièce touchée
      const hit = draft.rooms.find((r) => pointIn(p, r.polygon));
      setSelected(hit?.id ?? null);
    }
  }

  const finishRoom = () => {
    if (!draft || pending.length < 3) return;
    const id = `m${Date.now()}`;
    update({ rooms: [...draft.rooms, { id, name: `Pièce ${draft.rooms.length + 1}`, level, polygon: pending, writtenAreaM2: null, areaOverrideM2: null, windows: [], excluded: false }] });
    setSelected(id);
    setPending([]);
    setTool("none");
  };

  const confirmMeasure = () => {
    const l = parseDecimal(measureLen);
    if (!draft || pending.length !== 2 || !l || l <= 0) return;
    update({ measured: { a: pending[0]!, b: pending[1]!, lengthM: l } });
    setPending([]);
    setMeasureLen("");
    setTool("none");
  };

  const save = (then?: () => void) =>
    start(async () => {
      if (!draft) return;
      const r = await saveDraft(quoteId, level, draft);
      if (!r.ok) setMsg({ ok: false, text: r.message });
      else {
        setMsg({ ok: true, text: "Plan enregistré ✔" });
        then?.();
      }
    });

  // ----- Pas encore de lecture -----------------------------------------------
  if (!draft) {
    const left = quota ? quota.quota - quota.used : 0;
    return (
      <div className="space-y-6">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={imageUrl} alt="Plan importé" className="w-full rounded-xl border-2 border-slate-300" />
        <Card title="Lecture du plan">
          <p className="text-base text-slate-700">L&apos;IA repère les pièces, surfaces, cotes, fenêtres et pièces ouvertes. Vous vérifiez tout avant le calcul.</p>
          {!aiEnabled && <Notice>La lecture automatique n&apos;est pas activée sur ce compte : dessinez les pièces à la main.</Notice>}
          {msg && <Notice tone={msg.ok ? "ok" : "danger"}>{msg.text}</Notice>}
          {aiEnabled && (
            <Button
              type="button"
              full
              disabled={busy || left <= 0}
              onClick={() =>
                start(async () => {
                  setMsg(null);
                  const r = await analyzePlan(quoteId, level);
                  if (r.ok) setDraft(r.draft);
                  else setMsg({ ok: false, text: r.message });
                })
              }
            >
              {busy ? "Lecture en cours (jusqu'à une minute)…" : `Lire le plan automatiquement`}
            </Button>
          )}
          {quota && aiEnabled && (
            <p className="text-sm text-slate-600">
              1 analyse · reste {Math.max(0, left)} / {quota.quota} ce mois-ci.
            </p>
          )}
          <Button type="button" variant="secondary" full disabled={busy} onClick={() => setDraft(emptyDraft(width, height, level))}>
            Dessiner les pièces à la main
          </Button>
          <button
            type="button"
            className="w-full text-base font-bold text-danger underline"
            disabled={busy}
            onClick={() => {
              if (!confirm("Retirer ce plan ? Les pièces déjà créées restent.")) return;
              start(async () => {
                await deletePlan(quoteId, level);
                router.refresh();
              });
            }}
          >
            Changer de plan
          </button>
        </Card>
      </div>
    );
  }

  // ----- Vérification des pièces proposées -----------------------------------
  if (step === "rooms") return <RoomsProposal quoteId={quoteId} level={level} draft={draft} onBack={() => setStep("plan")} />;

  // ----- Plan et corrections -------------------------------------------------
  const sel = draft.rooms.find((r) => r.id === selected) ?? null;
  return (
    <div className="space-y-6">
      {draft.notes.length > 0 && (
        <Notice>
          <strong>À vérifier :</strong> {draft.notes.join(" · ")}
        </Notice>
      )}
      <div className="sticky top-16 z-[5] flex flex-wrap gap-2 rounded-xl bg-white/95 p-2 shadow" role="toolbar" aria-label="Outils">
        {(
          [
            ["none", "Sélection"],
            ["measure", "Mesurer une cote"],
            ["room", "Dessiner une pièce"],
            ["window", "Ajouter une fenêtre"],
          ] as [Tool, string][]
        ).map(([t, label]) => (
          <button
            key={t}
            type="button"
            disabled={t === "window" && !sel}
            onClick={() => {
              setTool(t);
              setPending([]);
            }}
            className={`min-h-11 rounded-lg border-2 px-3 text-sm font-bold disabled:opacity-40 ${tool === t ? "border-brand bg-brand text-white" : "border-slate-300 bg-white"}`}
          >
            {label}
          </button>
        ))}
      </div>
      {tool === "measure" && (
        <Notice>
          Touchez les deux extrémités d&apos;un mur dont vous connaissez la longueur{pending.length === 2 ? ", puis indiquez-la :" : "."}
          {pending.length === 2 && (
            <span className="mt-2 grid grid-cols-[1fr_auto] items-end gap-2">
              <Field label="Longueur réelle" inputMode="decimal" suffix="m" value={measureLen} onChange={setMeasureLen} placeholder="4,20" />
              <Button type="button" onClick={confirmMeasure}>
                Valider
              </Button>
            </span>
          )}
        </Notice>
      )}
      {tool === "room" && (
        <Notice>
          Touchez les angles de la pièce dans l&apos;ordre ({pending.length} point{pending.length > 1 ? "s" : ""}).{" "}
          <button type="button" className="font-bold underline" disabled={pending.length < 3} onClick={finishRoom}>
            Terminer la pièce
          </button>
        </Notice>
      )}
      {tool === "window" && sel && <Notice>Fenêtre de « {sel.name} » : touchez ses deux extrémités le long du mur.</Notice>}

      <PlanCanvas imageUrl={imageUrl} width={width} height={height} onPoint={onPoint} cursor={tool === "none" ? "pointer" : "crosshair"}>
        {draft.rooms.map((r, i) => {
          const c = centroid(r.polygon);
          const color = COLORS[i % COLORS.length]!;
          return (
            <g key={r.id} opacity={r.excluded ? 0.45 : 1}>
              <polygon points={r.polygon.map((p) => `${p.x},${p.y}`).join(" ")} fill={color} fillOpacity={r.id === selected ? 0.3 : 0.14} stroke={color} strokeWidth={u / (r.id === selected ? 2 : 4)} />
              {r.windows.map((w) => (
                <line key={w.id} x1={w.a.x} y1={w.a.y} x2={w.b.x} y2={w.b.y} stroke="#0EA5E9" strokeWidth={u * 0.9} strokeLinecap="round" />
              ))}
              <text x={c.x} y={c.y} fontSize={u * 2.8} textAnchor="middle" fontWeight="bold" fill="#111827" stroke="white" strokeWidth={u / 2} paintOrder="stroke">
                {r.name}
              </text>
              <text x={c.x} y={c.y + u * 3.2} fontSize={u * 2.4} textAnchor="middle" fill="#111827" stroke="white" strokeWidth={u / 2} paintOrder="stroke">
                {m2(roomArea(r, scale))}
              </text>
            </g>
          );
        })}
        {draft.measured && <line x1={draft.measured.a.x} y1={draft.measured.a.y} x2={draft.measured.b.x} y2={draft.measured.b.y} stroke="#B91C1C" strokeWidth={u / 2} strokeDasharray={`${u} ${u / 2}`} />}
        {pending.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={u * 0.7} fill="#B91C1C" />
        ))}
        {tool === "room" && pending.length > 1 && <polyline points={pending.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke="#B91C1C" strokeWidth={u / 3} />}
        {draft.northDeg !== null && <NorthArrow deg={draft.northDeg} width={width} height={height} />}
      </PlanCanvas>

      <Card title="Échelle et orientation">
        {scale ? (
          <p className="text-base">
            Échelle {SCALE_LABELS[scale.source]} : 1 m = {(1 / scale.mPerPx).toLocaleString("fr-FR", { maximumFractionDigits: 0 })} px du plan.
          </p>
        ) : (
          <Notice tone="danger">Échelle inconnue : touchez « Mesurer une cote » et indiquez la longueur d&apos;un mur connu (ex. 4,20 m).</Notice>
        )}
        <div>
          <p className="text-base font-bold">Flèche du nord</p>
          <p className="text-sm text-slate-600">{draft.northDeg === null ? "Pas de flèche : l'orientation des pièces ne sera pas déduite." : `Nord à ${Math.round(draft.northDeg)}° (sens horaire depuis le haut du plan).`}</p>
          <div className="mt-2 grid grid-cols-4 gap-2">
            <Button type="button" variant="secondary" onClick={() => update({ northDeg: (((draft.northDeg ?? 0) - 15) % 360 + 360) % 360 })} aria-label="Tourner de 15° vers la gauche">
              ⟲ 15°
            </Button>
            <Button type="button" variant="secondary" onClick={() => update({ northDeg: 0 })}>
              Haut
            </Button>
            <Button type="button" variant="secondary" onClick={() => update({ northDeg: ((draft.northDeg ?? 0) + 15) % 360 })} aria-label="Tourner de 15° vers la droite">
              ⟳ 15°
            </Button>
            <Button type="button" variant="secondary" onClick={() => update({ northDeg: null })}>
              Aucune
            </Button>
          </div>
        </div>
        <Field
          label="Surface totale du logement (si connue)"
          inputMode="decimal"
          suffix="m²"
          value={decimalToInput(draft.declaredTotalM2)}
          onChange={(v) => update({ declaredTotalM2: parseDecimal(v) })}
          hint={total !== null ? `Somme des pièces de ce plan : ${m2(total)}` : undefined}
        />
        {totalCheck?.message && <Notice tone="danger">{totalCheck.message}</Notice>}
      </Card>

      <Card title={`Pièces (${draft.rooms.length})`}>
        {draft.rooms.length === 0 && <p className="text-base text-slate-600">Aucune pièce : utilisez « Dessiner une pièce ».</p>}
        <ul className="space-y-3">
          {draft.rooms.map((r) => (
            <li key={r.id} className={`rounded-xl border-2 p-3 ${r.id === selected ? "border-brand" : "border-slate-200"}`} onFocus={() => setSelected(r.id)}>
              <div className="grid gap-2 sm:grid-cols-2">
                <Field label="Nom" value={r.name} onChange={(v) => updateRoom(r.id, { name: v })} />
                <Field
                  label="Surface"
                  inputMode="decimal"
                  suffix="m²"
                  value={decimalToInput(r.areaOverrideM2)}
                  placeholder={m2(roomArea({ ...r, areaOverrideM2: null }, scale)).replace(" m²", "")}
                  onChange={(v) => updateRoom(r.id, { areaOverrideM2: parseDecimal(v) })}
                  hint={r.writtenAreaM2 ? "Lue sur le plan ; corrigez si besoin" : "Mesurée à l'échelle ; corrigez si besoin"}
                />
              </div>
              <label className="mt-2 flex items-center gap-3 text-base">
                <input type="checkbox" className="h-6 w-6" checked={r.excluded} onChange={(e) => updateRoom(r.id, { excluded: e.target.checked })} />
                Ne pas climatiser (WC, couloir, garage…)
              </label>
              {r.windows.length > 0 && (
                <ul className="mt-2 space-y-2">
                  {r.windows.map((w) => (
                    <li key={w.id} className="grid grid-cols-[1fr_auto] items-end gap-2">
                      <Select
                        label={`${WINDOW_LABELS[w.kind]} · ${windowWidth(w, scale)?.toLocaleString("fr-FR") ?? "?"} m`}
                        value={w.kind}
                        onChange={(v) => updateRoom(r.id, { windows: r.windows.map((x) => (x.id === w.id ? { ...x, kind: v as WindowKind } : x)) })}
                        options={Object.entries(WINDOW_LABELS).map(([value, label]) => ({ value, label }))}
                      />
                      <button type="button" className="min-h-14 rounded-xl border-2 border-slate-300 px-3 font-bold" aria-label="Retirer cette fenêtre" onClick={() => updateRoom(r.id, { windows: r.windows.filter((x) => x.id !== w.id) })}>
                        ✕
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-2 flex gap-4 text-base">
                <button
                  type="button"
                  className="font-bold text-brand underline"
                  onClick={() => {
                    setSelected(r.id);
                    setTool("window");
                    setPending([]);
                  }}
                >
                  + Fenêtre
                </button>
                <button type="button" className="font-bold text-danger underline" onClick={() => update({ rooms: draft.rooms.filter((x) => x.id !== r.id), openings: draft.openings.filter((o) => o.a !== r.id && o.b !== r.id) })}>
                  Supprimer la pièce
                </button>
              </div>
            </li>
          ))}
        </ul>
      </Card>

      {draft.openings.length > 0 && (
        <Card title="Pièces ouvertes entre elles">
          <p className="text-base text-slate-700">Cochées : traitées comme une seule zone pour le dimensionnement.</p>
          {draft.openings.map((o, i) => {
            const a = draft.rooms.find((r) => r.id === o.a)?.name;
            const b = draft.rooms.find((r) => r.id === o.b)?.name;
            return (
              <label key={i} className="flex items-center gap-3 text-base">
                <input type="checkbox" className="h-6 w-6" checked={o.merge} onChange={(e) => update({ openings: draft.openings.map((x, j) => (j === i ? { ...x, merge: e.target.checked } : x)) })} />
                {a} + {b}
              </label>
            );
          })}
        </Card>
      )}

      {msg && <Notice tone={msg.ok ? "ok" : "danger"}>{msg.text}</Notice>}
      <div className="flex flex-col-reverse gap-3 sm:flex-row">
        <Button type="button" variant="secondary" disabled={busy} onClick={() => save()}>
          Enregistrer
        </Button>
        <Button type="button" full disabled={busy || draft.rooms.filter((r) => !r.excluded).length === 0} onClick={() => save(() => setStep("rooms"))}>
          Suivant : vérifier les pièces à climatiser
        </Button>
      </div>
      {validatedAt && <p className="text-center text-sm text-slate-600">Pièces déjà créées depuis ce plan le {new Date(validatedAt).toLocaleDateString("fr-FR")} : les valider de nouveau les remplace.</p>}
    </div>
  );
}

function pointIn(p: Pt, poly: Pt[]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function RoomsProposal({ quoteId, level, draft, onBack }: { quoteId: string; level: number; draft: PlanDraft; onBack: () => void }) {
  const router = useRouter();
  const initial = useMemo(
    () =>
      proposeRooms(draft).map(
        (p): PlanRoomInput & { glazing: number; windows: string } => ({
          name: p.name,
          surface: decimalToInput(p.surfaceM2),
          level: p.level,
          orientation: p.orientation,
          largeGlazing: p.largeGlazing,
          insulation: "moyenne",
          height: "2,50",
          underRoof: false,
          indoorType: "mural",
          glazing: p.glazingM2,
          windows: p.windows.map((w) => `${WINDOW_LABELS[w.kind].toLowerCase()} ${w.orientation === "aucune" ? "" : ORIENTATION_LABELS[w.orientation]}`.trim()).join(", "),
        }),
      ),
    [draft],
  );
  const [rooms, setRooms] = useState(initial);
  const [errors, setErrors] = useState<Record<string, Record<string, string>>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const set = (i: number, patch: Partial<(typeof rooms)[number]>) => setRooms(rooms.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div className="space-y-6">
      <Card title={`Pièces à climatiser – ${LEVEL_LABELS[level] ?? `niveau ${level}`}`}>
        <p className="text-base text-slate-700">Orientation déduite de la façade la plus vitrée et de la flèche du nord ; « vitrage important » au-delà de 20 % de la surface au sol. Tout reste modifiable.</p>
      </Card>
      {rooms.map((r, i) => (
        <Card key={i} title={r.name}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Nom" value={r.name} onChange={(v) => set(i, { name: v })} error={errors[`new-${i}`]?.name} />
            <Field label="Surface" inputMode="decimal" suffix="m²" value={r.surface} onChange={(v) => set(i, { surface: v })} error={errors[`new-${i}`]?.surface} />
            <Select label="Orientation" value={r.orientation} onChange={(v) => set(i, { orientation: v as Orientation })} options={Object.entries(ORIENTATION_LABELS).map(([value, label]) => ({ value, label }))} />
            <Select label="Isolation" value={r.insulation} onChange={(v) => set(i, { insulation: v as Insulation })} options={Object.entries(INSULATION_LABELS).map(([value, label]) => ({ value, label }))} />
            <Field label="Hauteur sous plafond" inputMode="decimal" suffix="m" value={r.height} onChange={(v) => set(i, { height: v })} error={errors[`new-${i}`]?.height} />
            <Select label="Unité intérieure souhaitée" value={r.indoorType} onChange={(v) => set(i, { indoorType: v as IndoorChoice })} options={Object.entries(INDOOR_LABELS).map(([value, label]) => ({ value, label }))} />
          </div>
          {r.windows && <p className="text-sm text-slate-600">Ouvertures : {r.windows} (≈ {r.glazing.toLocaleString("fr-FR")} m² vitrés)</p>}
          <label className="flex items-center gap-3 text-base">
            <input type="checkbox" className="h-6 w-6" checked={r.largeGlazing} onChange={(e) => set(i, { largeGlazing: e.target.checked })} />
            Vitrage important
          </label>
          <label className="flex items-center gap-3 text-base">
            <input type="checkbox" className="h-6 w-6" checked={r.underRoof} onChange={(e) => set(i, { underRoof: e.target.checked })} />
            Sous toiture
          </label>
        </Card>
      ))}
      {msg && <Notice tone="danger">{msg}</Notice>}
      <div className="flex flex-col-reverse gap-3 sm:flex-row">
        <Button type="button" variant="secondary" disabled={busy} onClick={onBack}>
          Retour au plan
        </Button>
        <Button
          type="button"
          full
          disabled={busy}
          onClick={() =>
            start(async () => {
              const res = await applyPlanRooms(
                quoteId,
                level,
                rooms.map(({ glazing: _g, windows: _w, ...x }) => x),
              );
              if (!res.ok) {
                setMsg(res.message);
                setErrors("errors" in res ? res.errors : {});
              } else router.push(`/app/devis/${quoteId}?etape=2`);
            })
          }
        >
          {busy ? "Création des pièces…" : "Valider et passer au dimensionnement"}
        </Button>
      </div>
    </div>
  );
}
