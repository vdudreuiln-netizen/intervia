"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Field, LinkButton, Notice, Select } from "@/components/ui";
import { decimalToInput, parseDecimal } from "@/lib/format";
import type { Pt } from "@/lib/plans/geometry";
import { MARKER_LABELS, ROUTE_COLORS, ROUTE_LABELS, routeLengthM, type Layout, type MarkerKind, type MetreReportLine, type RouteKind } from "@/lib/plans/layout";
import { saveLayout } from "./actions";
import { NorthArrow, PlanCanvas, unit } from "./PlanCanvas";

export interface EquipmentLite {
  systems: { key: string; tag: string; label: string; indoors: { key: string; tag: string; label: string; gainable: boolean }[] }[];
}

type Mode = { kind: "select" } | { kind: "place"; marker: MarkerKind; key: string | null } | { kind: "route"; route: RouteKind; key: string };

const fmtM = (n: number) => `${n.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} m`;
const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now() + Math.random()));

export function LayoutEditor({ quoteId, level, imageUrl, width, height, mPerPx, northDeg, initial, equipment }: { quoteId: string; level: number; imageUrl: string; width: number; height: number; mPerPx: number | null; northDeg: number | null; initial: Layout; equipment: EquipmentLite }) {
  const router = useRouter();
  const [layout, setLayout] = useState<Layout>(initial);
  const [mode, setMode] = useState<Mode>({ kind: "select" });
  const [points, setPoints] = useState<Pt[]>([]);
  const [result, setResult] = useState<{ report: MetreReportLine[]; warnings: string[]; todo: string[] } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const u = unit(width, height);

  const tagOf = new Map<string, string>();
  for (const s of equipment.systems) {
    tagOf.set(s.key, s.tag);
    for (const i of s.indoors) tagOf.set(i.key, i.tag);
  }
  const gainables = equipment.systems.flatMap((s) => s.indoors.filter((i) => i.gainable));

  // Choix « placer » et « tracer »
  const placeOptions: { value: string; label: string }[] = [
    ...equipment.systems.flatMap((s) => [...s.indoors.map((i) => ({ value: `ui|${i.key}`, label: `${i.tag} – ${i.label}` })), { value: `ue|${s.key}`, label: `${s.tag} – ${s.label}` }]),
    ...gainables.flatMap((g) => [
      { value: `bouche|${g.key}`, label: `Bouche de soufflage (${g.tag})` },
      { value: `grille|${g.key}`, label: `Grille de reprise (${g.tag})` },
    ]),
    { value: "tableau|", label: "Tableau électrique" },
    { value: "evacuation|", label: "Évacuation des condensats" },
  ];
  const routeOptions: { value: string; label: string }[] = equipment.systems.flatMap((s) => [
    ...s.indoors.flatMap((i) => [
      { value: `liaison|${i.key}`, label: `Liaison ${i.tag} → ${s.tag}` },
      { value: `condensats|${i.key}`, label: `Condensats ${i.tag}` },
      { value: `goulotte|${i.key}`, label: `Goulotte ${i.tag}` },
      ...(i.gainable ? [{ value: `gaine|${i.key}`, label: `Gaine ${i.tag} → bouche` }] : []),
    ]),
    { value: `electrique|${s.key}`, label: `Alimentation électrique ${s.tag}` },
  ]);
  const [placeChoice, setPlaceChoice] = useState(placeOptions[0]?.value ?? "");
  const [routeChoice, setRouteChoice] = useState(routeOptions[0]?.value ?? "");

  function onPoint(p: Pt) {
    if (mode.kind === "place") {
      const unique = mode.marker === "ui" || mode.marker === "ue";
      setLayout((l) => ({
        ...l,
        markers: [...l.markers.filter((m) => !(unique && m.kind === mode.marker && m.equipmentKey === mode.key)), { id: newId(), kind: mode.marker, x: p.x, y: p.y, equipmentKey: mode.key }],
      }));
      if (unique) setMode({ kind: "select" });
    } else if (mode.kind === "route") {
      // accroche sur un repère proche (début et fin des tracés)
      const snap = layout.markers.find((m) => Math.hypot(m.x - p.x, m.y - p.y) < u * 2.5);
      setPoints([...points, snap ? { x: snap.x, y: snap.y } : p]);
    }
  }

  const finishRoute = () => {
    if (mode.kind !== "route" || points.length < 2) return;
    setLayout((l) => ({ ...l, routes: [...l.routes, { id: newId(), kind: mode.route, equipmentKey: mode.key, points, extraM: 0 }] }));
    setPoints([]);
  };

  const markerTag = (kind: MarkerKind, key: string | null, id: string) => {
    if (kind === "ui" || kind === "ue") return tagOf.get(key ?? "") ?? "?";
    const same = layout.markers.filter((m) => m.kind === kind);
    const n = same.findIndex((m) => m.id === id) + 1;
    return { bouche: "B", grille: "G", tableau: "T", evacuation: "C" }[kind] + (same.length > 1 ? String(n) : "");
  };

  return (
    <div className="space-y-6">
      {!mPerPx && <Notice tone="danger">Échelle du plan inconnue : retournez à la lecture du plan et mesurez une cote, sinon les longueurs ne peuvent pas être calculées.</Notice>}
      <Card title="Outils">
        <div className="grid grid-cols-[1fr_auto] items-end gap-2">
          <Select label="Placer" value={placeChoice} onChange={setPlaceChoice} options={placeOptions} />
          <Button
            type="button"
            variant={mode.kind === "place" ? "primary" : "secondary"}
            onClick={() => {
              const [m, k] = placeChoice.split("|");
              setMode({ kind: "place", marker: m as MarkerKind, key: k || null });
              setPoints([]);
            }}
          >
            Placer
          </Button>
        </div>
        <div className="grid grid-cols-[1fr_auto] items-end gap-2">
          <Select label="Tracer" value={routeChoice} onChange={setRouteChoice} options={routeOptions} />
          <Button
            type="button"
            variant={mode.kind === "route" ? "primary" : "secondary"}
            onClick={() => {
              const [r, k] = routeChoice.split("|");
              setMode({ kind: "route", route: r as RouteKind, key: k! });
              setPoints([]);
            }}
          >
            Tracer
          </Button>
        </div>
        {mode.kind === "place" && <Notice>Touchez le plan à l&apos;emplacement de : {placeOptions.find((o) => o.value === `${mode.marker}|${mode.key ?? ""}`)?.label}.</Notice>}
        {mode.kind === "route" && (
          <Notice>
            Touchez le parcours point par point (les repères aimantent le tracé){points.length ? ` — ${points.length} point${points.length > 1 ? "s" : ""}` : ""}.{" "}
            <button type="button" className="font-bold underline" disabled={points.length < 2} onClick={finishRoute}>
              Terminer ce tracé
            </button>{" "}
            ·{" "}
            <button type="button" className="font-bold underline" onClick={() => setPoints(points.slice(0, -1))} disabled={!points.length}>
              Annuler le dernier point
            </button>
          </Notice>
        )}
        {mode.kind !== "select" && (
          <Button type="button" variant="secondary" onClick={() => (setMode({ kind: "select" }), setPoints([]))}>
            Fin
          </Button>
        )}
      </Card>

      <PlanCanvas imageUrl={imageUrl} width={width} height={height} onPoint={onPoint} cursor={mode.kind === "select" ? "default" : "crosshair"}>
        {layout.routes.map((r) => (
          <polyline key={r.id} points={r.points.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke={ROUTE_COLORS[r.kind]} strokeWidth={u * 0.6} strokeLinejoin="round" strokeLinecap="round" strokeDasharray={r.kind === "condensats" ? `${u} ${u / 2}` : undefined} />
        ))}
        {points.length > 0 && mode.kind === "route" && <polyline points={points.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke={ROUTE_COLORS[mode.route]} strokeWidth={u * 0.6} strokeOpacity={0.6} />}
        {points.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={u * 0.5} fill="#B91C1C" />
        ))}
        {layout.markers.map((m) => (
          <g key={m.id}>
            <circle cx={m.x} cy={m.y} r={u * 2.6} fill={m.kind === "ue" ? "#111827" : m.kind === "ui" ? "#0B4F8A" : "#7C3AED"} stroke="white" strokeWidth={u / 4} />
            <text x={m.x} y={m.y + u * 0.85} fontSize={u * 2.4} textAnchor="middle" fill="white" fontWeight="bold">
              {markerTag(m.kind, m.equipmentKey, m.id)}
            </text>
          </g>
        ))}
        {northDeg !== null && <NorthArrow deg={northDeg} width={width} height={height} />}
      </PlanCanvas>

      <Card title="Repères placés">
        {layout.markers.length === 0 && <p className="text-base text-slate-600">Aucun : utilisez « Placer ».</p>}
        <ul className="divide-y-2 divide-slate-200">
          {layout.markers.map((m) => (
            <li key={m.id} className="flex items-center justify-between py-2 text-base">
              <span>
                <strong>{markerTag(m.kind, m.equipmentKey, m.id)}</strong> · {MARKER_LABELS[m.kind]}
              </span>
              <button type="button" className="font-bold text-danger underline" onClick={() => setLayout({ ...layout, markers: layout.markers.filter((x) => x.id !== m.id) })}>
                Retirer
              </button>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Tracés et longueurs">
        {layout.routes.length === 0 && <p className="text-base text-slate-600">Aucun : utilisez « Tracer ».</p>}
        <ul className="space-y-3">
          {layout.routes.map((r) => (
            <li key={r.id} className="rounded-xl border-2 border-slate-200 p-3">
              <p className="text-base font-bold" style={{ color: ROUTE_COLORS[r.kind] }}>
                {ROUTE_LABELS[r.kind]} {tagOf.get(r.equipmentKey)} · {mPerPx ? fmtM(routeLengthM(r, mPerPx)) : "échelle inconnue"}
              </p>
              <div className="grid grid-cols-[1fr_auto] items-end gap-2">
                <Field
                  label="Supplément (montées, passage d'étage…)"
                  inputMode="decimal"
                  suffix="m"
                  value={decimalToInput(r.extraM || null)}
                  onChange={(v) => setLayout({ ...layout, routes: layout.routes.map((x) => (x.id === r.id ? { ...x, extraM: Math.max(0, Math.min(50, parseDecimal(v) ?? 0)) } : x)) })}
                />
                <button type="button" className="min-h-14 rounded-xl border-2 border-slate-300 px-3 font-bold" aria-label="Supprimer ce tracé" onClick={() => setLayout({ ...layout, routes: layout.routes.filter((x) => x.id !== r.id) })}>
                  ✕
                </button>
              </div>
            </li>
          ))}
        </ul>
      </Card>

      {msg && <Notice tone="danger">{msg}</Notice>}
      {result && (
        <Card title="Reporté dans le métré">
          {result.warnings.map((w) => (
            <Notice key={w} tone="danger">
              {w}
            </Notice>
          ))}
          <ul className="text-base">
            {result.report.map((l) => (
              <li key={l.key}>
                {l.label} : <strong>{fmtM(l.lengthM)}</strong>
              </li>
            ))}
          </ul>
          {result.todo.length > 0 && (
            <div>
              <p className="text-base font-bold">Reste à faire (non bloquant) :</p>
              <ul className="list-disc pl-6 text-base text-slate-700">
                {result.todo.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </div>
          )}
          <LinkButton href={`/app/devis/${quoteId}?etape=5`} full>
            Voir le métré
          </LinkButton>
        </Card>
      )}
      <Button
        type="button"
        full
        disabled={busy}
        onClick={() =>
          start(async () => {
            setMsg(null);
            const r = await saveLayout(quoteId, level, layout);
            if (!r.ok) setMsg(r.message);
            else {
              setResult(r);
              router.refresh();
            }
          })
        }
      >
        {busy ? "Enregistrement…" : "Enregistrer et reporter les longueurs au métré"}
      </Button>
    </div>
  );
}
