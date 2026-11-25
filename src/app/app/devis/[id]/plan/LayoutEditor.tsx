"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Field, LinkButton, Notice, Select } from "@/components/ui";
import { decimalToInput, parseDecimal } from "@/lib/format";
import type { Pt } from "@/lib/plans/geometry";
import { CONTEXT_MARKERS, equipmentTags, MARKER_LABELS, markerTag, ROUTE_COLORS, ROUTE_LABELS, routeLengthM, SUPPORT_LABELS, SUPPORTS_UE, SUPPORTS_UI, type Layout, type SupportKind, type Marker, type MarkerKind, type MetreReportLine, type RouteKind, type UeMount } from "@/lib/plans/layout";
import { blocking, dirOf, validationBlockers, evaluateRules, INSTALL_HEIGHT_M, POSE_HEIGHTS, R32_WARNING, type Finding, type RuleContext } from "@/lib/plans/rules";
import { suggestDucted, suggestIndoor, suggestMissing, suggestOutdoor, type SuggestContext } from "@/lib/plans/suggest";
import { saveLayout } from "./actions";
import { NorthArrow, PlanCanvas, unit } from "./PlanCanvas";

type Mode = { kind: "select" } | { kind: "place"; marker: MarkerKind; key: string | null } | { kind: "route"; route: RouteKind; key: string };

const fmtM = (n: number) => `${n.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} m`;
const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now() + Math.random()));
const MOUNTS: Record<UeMount, string> = { sol: "Au sol", mural_bas: "Murale, accessible du sol", mural_haut: "Murale en hauteur", toiture: "En toiture" };
const MARKER_COLOR: Partial<Record<MarkerKind, string>> = { ue: "#111827", ui: "#0B4F8A", bouche: "#7C3AED", grille: "#7C3AED", tableau: "#B45309", evacuation: "#0E7490" };

interface Props {
  quoteId: string;
  level: number;
  imageUrl: string;
  width: number;
  height: number;
  northDeg: number | null;
  /** Contexte complet des règles (tous niveaux, sans aucun prix). */
  context: RuleContext;
  quoteRooms: { id: string; name: string }[];
  validatedAt: string | null;
  /** Statut du devis : signé (« accepte ») = alertes rouges en simple rappel. */
  quoteStatus: string;
}

export function LayoutEditor({ quoteId, level, imageUrl, width, height, northDeg, context, quoteRooms, validatedAt, quoteStatus }: Props) {
  const router = useRouter();
  const own = context.plans.find((p) => p.level === level)!;
  const [layout, setLayout] = useState<Layout>(own.layout);
  const [mode, setMode] = useState<Mode>({ kind: "select" });
  const [points, setPoints] = useState<Pt[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [drag, setDrag] = useState<string | null>(null);
  const moved = useRef(false);
  const [variants, setVariants] = useState<Record<string, number>>({});
  const [forceText, setForceText] = useState<Record<string, string>>({});
  const [result, setResult] = useState<{ report: MetreReportLine[]; warnings: string[]; todo: string[]; validated: boolean } | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, start] = useTransition();
  const u = unit(width, height);
  const mPerPx = own.mPerPx;
  const eq = context.equipment;
  const tags = useMemo(() => equipmentTags(eq), [eq]);

  // Règles recalculées en direct à chaque déplacement
  const live: RuleContext = useMemo(() => ({ ...context, plans: context.plans.map((p) => (p.level === level ? { ...p, layout } : p)) }), [context, layout, level]);
  const findings = useMemo(() => evaluateRules(live), [live]);
  const red = blocking(findings);
  const signedQuote = quoteStatus === "accepte";
  const blockers = validationBlockers(findings, quoteStatus);
  const byElement = (id: string) => findings.filter((f) => f.elementId === id);
  const sctx: SuggestContext = { plan: { ...own, layout }, equipment: eq, quoteRooms, settings: context.settings };
  const elsewhere = new Set(context.plans.filter((p) => p.level !== level).flatMap((p) => p.layout.markers.filter((m) => m.equipmentKey).map((m) => `${m.kind}:${m.equipmentKey}`)));

  const indoors = eq.systems.flatMap((s) => s.indoors.map((i) => ({ ...i, sys: s })));
  const roomName = new Map(quoteRooms.map((r) => [r.id, r.name]));
  const indoorLabel = (key: string) => {
    const i = indoors.find((x) => x.key === key);
    return i ? `${tags.indoor.get(key)} – ${i.roomIds.map((r) => roomName.get(r) ?? "").join(", ")}` : key;
  };
  const gainables = indoors.filter((i) => i.product.type === "ui_gainable");
  const placeOptions = [
    ...eq.systems.flatMap((s) => [...s.indoors.map((i) => ({ value: `ui|${i.key}`, label: indoorLabel(i.key) })), { value: `ue|${s.key}`, label: `${tags.outdoor.get(s.key)} – unité extérieure ${s.outdoor.reference}` }]),
    ...gainables.flatMap((g) => [
      { value: `bouche|${g.key}`, label: `Bouche de soufflage (${tags.indoor.get(g.key)})` },
      { value: `grille|${g.key}`, label: `Grille de reprise (${tags.indoor.get(g.key)})` },
    ]),
    { value: "tableau|", label: "Tableau électrique" },
    { value: "evacuation|", label: "Évacuation des condensats" },
    ...CONTEXT_MARKERS.map((k) => ({ value: `${k}|`, label: `Repère : ${MARKER_LABELS[k]}` })),
  ];
  const routeOptions = eq.systems.flatMap((s) => [
    ...s.indoors.flatMap((i) => [
      { value: `liaison|${i.key}`, label: `Liaison ${tags.indoor.get(i.key)} → ${tags.outdoor.get(s.key)}` },
      { value: `condensats|${i.key}`, label: `Condensats ${tags.indoor.get(i.key)}` },
      { value: `goulotte|${i.key}`, label: `Goulotte ${tags.indoor.get(i.key)}` },
      ...(i.product.type === "ui_gainable" ? [{ value: `gaine|${i.key}`, label: `Gaine ${tags.indoor.get(i.key)} → bouche` }] : []),
    ]),
    { value: `electrique|${s.key}`, label: `Alimentation électrique ${tags.outdoor.get(s.key)}` },
  ]);
  const [placeChoice, setPlaceChoice] = useState(placeOptions[0]?.value ?? "");
  const [routeChoice, setRouteChoice] = useState(routeOptions[0]?.value ?? "");

  const patch = (id: string, p: Partial<Marker>) => setLayout((l) => ({ ...l, markers: l.markers.map((m) => (m.id === id ? { ...m, ...p } : m)) }));

  function onPoint(p: Pt) {
    if (mode.kind === "place") {
      const unique = mode.marker === "ui" || mode.marker === "ue";
      const id = newId();
      setLayout((l) => ({ ...l, markers: [...l.markers.filter((m) => !(unique && m.kind === mode.marker && m.equipmentKey === mode.key)), { id, kind: mode.marker, x: p.x, y: p.y, equipmentKey: mode.key, ...(mode.marker === "ue" ? { mount: "sol" as const } : {}) }] }));
      setSelected(id);
      if (unique) setMode({ kind: "select" });
    } else if (mode.kind === "route") {
      const snap = layout.markers.find((m) => Math.hypot(m.x - p.x, m.y - p.y) < u * 3);
      setPoints([...points, snap ? { x: snap.x, y: snap.y } : p]);
    } else setSelected(null);
  }

  const finishRoute = () => {
    if (mode.kind !== "route" || points.length < 2) return;
    setLayout((l) => ({ ...l, routes: [...l.routes, { id: newId(), kind: mode.route, equipmentKey: mode.key, points, extraM: 0 }] }));
    setPoints([]);
  };

  /** Propose tout ce qui manque sur ce niveau. */
  const suggestAll = () => {
    const added = suggestMissing(sctx, elsewhere, variants);
    if (added.length === 0) return setMsg({ ok: false, text: own.rooms.length === 0 ? "Pas de pièces lues sur ce plan : validez d'abord la lecture du plan, ou placez les éléments à la main." : "Tout est déjà placé sur ce niveau." });
    setMsg({ ok: true, text: `${added.length} emplacement${added.length > 1 ? "s" : ""} proposé${added.length > 1 ? "s" : ""} : déplacez-les au doigt, ou demandez une autre proposition.` });
    setLayout((l) => ({ ...l, markers: [...l.markers, ...added.map((m) => ({ ...m, id: newId() }))] }));
  };

  /** « Autre proposition » pour un élément proposé. */
  const another = (m: Marker) => {
    const vKey = `${m.kind === "ue" ? "ue" : "ui"}:${m.equipmentKey}`;
    const v = (variants[vKey] ?? 0) + 1;
    setVariants({ ...variants, [vKey]: v });
    const without = { ...sctx, plan: { ...sctx.plan, layout: { ...layout, markers: layout.markers.filter((x) => x.id !== m.id) } } };
    if (m.kind === "ue") {
      const s = suggestOutdoor(m.equipmentKey!, without, v);
      if (s) patch(m.id, { x: s.x, y: s.y, reason: s.reason, suggested: true });
    } else if (m.kind === "ui" && indoors.find((i) => i.key === m.equipmentKey)?.product.type !== "ui_gainable") {
      const s = suggestIndoor(m.equipmentKey!, without, v);
      if (s) patch(m.id, { x: s.x, y: s.y, angle: s.angle, reason: s.reason, suggested: true });
    } else if (m.equipmentKey) {
      const set = suggestDucted(m.equipmentKey, without, v);
      setLayout((l) => ({ ...l, markers: [...l.markers.filter((x) => !(x.equipmentKey === m.equipmentKey && x.suggested)), ...set.map((x) => ({ ...x, id: newId() }))] }));
    }
  };

  const force = (f: Finding) => {
    const key = `${f.ruleId}|${f.elementId}`;
    const reason = (forceText[key] ?? "").trim();
    if (reason.length < 3) return setMsg({ ok: false, text: "Indiquez le motif pour forcer cette règle." });
    setLayout((l) => ({ ...l, overrides: [...(l.overrides ?? []).filter((o) => !(o.ruleId === f.ruleId && o.elementId === f.elementId)), { ruleId: f.ruleId, elementId: f.elementId, reason, at: new Date().toISOString() }] }));
  };
  const unforce = (f: Finding) => setLayout((l) => ({ ...l, overrides: (l.overrides ?? []).filter((o) => !(o.ruleId === f.ruleId && o.elementId === f.elementId)) }));

  const save = (validate: boolean) =>
    start(async () => {
      setMsg(null);
      const r = await saveLayout(quoteId, level, layout, validate);
      if (!r.ok) setMsg({ ok: false, text: r.message });
      else {
        setResult(r);
        setLayout((l) => ({ ...l, markers: l.markers.map((m) => ({ ...m, suggested: undefined })) }));
        setMsg({ ok: true, text: r.validated ? "Implantation validée ✔ Longueurs reportées au métré." : "Enregistré ✔ Longueurs reportées au métré." });
        router.refresh();
      }
    });

  const sel = layout.markers.find((m) => m.id === selected) ?? null;
  const tagOf = (m: Marker) => markerTag(m, layout.markers, tags);

  return (
    <div className="space-y-6">
      {!mPerPx && <Notice tone="danger">Échelle du plan inconnue : retournez à la lecture du plan et mesurez une cote, sinon ni les longueurs ni les règles de distance ne peuvent être calculées.</Notice>}
      <Card title="Emplacements">
        <Button type="button" full onClick={suggestAll}>
          ✨ Proposer les emplacements
        </Button>
        <p className="text-sm text-slate-600">Une proposition par élément, avec sa raison. Déplacez au doigt ; « Autre proposition » en génère une variante. Ajoutez d&apos;abord les repères utiles (lit, canapé, cuisinière, rue, voisin) : les propositions en tiennent compte.</p>
        <div className="grid grid-cols-[1fr_auto] items-end gap-2">
          <Select label="Placer à la main" value={placeChoice} onChange={setPlaceChoice} options={placeOptions} />
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
        {mode.kind === "place" && <Notice>Touchez le plan à l&apos;emplacement voulu.</Notice>}
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

      <PlanCanvas
        imageUrl={imageUrl}
        width={width}
        height={height}
        onPoint={onPoint}
        dragging={drag !== null}
        onMove={(p) => {
          moved.current = true;
          if (drag) patch(drag, { x: p.x, y: p.y, suggested: undefined, reason: undefined });
        }}
        onUp={() => setDrag(null)}
        cursor={mode.kind === "select" ? "default" : "crosshair"}
      >
        {layout.routes.map((r) => (
          <polyline key={r.id} points={r.points.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke={ROUTE_COLORS[r.kind]} strokeWidth={u * 0.6} strokeLinejoin="round" strokeLinecap="round" strokeDasharray={r.kind === "condensats" ? `${u} ${u / 2}` : undefined} pointerEvents="none" />
        ))}
        {points.length > 0 && mode.kind === "route" && <polyline points={points.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke={ROUTE_COLORS[mode.route]} strokeWidth={u * 0.6} strokeOpacity={0.6} pointerEvents="none" />}
        {points.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={u * 0.5} fill="#B91C1C" pointerEvents="none" />
        ))}
        {layout.markers.map((m) => {
          const fs = byElement(m.id);
          const ring = fs.some((f) => f.severity === "rouge" && !f.forcedReason && !f.autoFix) ? "#DC2626" : fs.some((f) => f.severity === "orange" || f.autoFix) ? "#F59E0B" : "white";
          const d = m.angle !== undefined ? dirOf(m.angle) : null;
          const context = CONTEXT_MARKERS.includes(m.kind);
          return (
            <g
              key={m.id}
              style={{ cursor: mode.kind === "select" ? "grab" : undefined, touchAction: "none" }}
              onPointerDown={(e) => {
                if (mode.kind !== "select") return;
                e.stopPropagation();
                moved.current = false;
                setSelected(m.id);
                setDrag(m.id);
              }}
              onClick={(e) => mode.kind === "select" && e.stopPropagation()}
            >
              {d && <line x1={m.x} y1={m.y} x2={m.x + d.x * u * 6} y2={m.y + d.y * u * 6} stroke="#0B4F8A" strokeWidth={u * 0.5} strokeLinecap="round" markerEnd="url(#arrow)" />}
              <circle cx={m.x} cy={m.y} r={u * 2.6} fill={context ? "#F8FAFC" : MARKER_COLOR[m.kind] ?? "#475569"} fillOpacity={m.suggested ? 0.75 : 1} stroke={m.id === selected ? "#22C55E" : ring} strokeWidth={m.id === selected ? u * 0.7 : u * 0.5} strokeDasharray={m.suggested ? `${u} ${u / 2}` : undefined} />
              <text x={m.x} y={m.y + u * 0.8} fontSize={context ? u * 1.6 : u * 2.4} textAnchor="middle" fill={context ? "#111827" : "white"} fontWeight="bold" pointerEvents="none">
                {tagOf(m)}
              </text>
            </g>
          );
        })}
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#0B4F8A" />
          </marker>
        </defs>
        {northDeg !== null && <NorthArrow deg={northDeg} width={width} height={height} />}
      </PlanCanvas>

      {sel && (
        <Card title={`${tagOf(sel)} · ${MARKER_LABELS[sel.kind]}`}>
          {sel.reason && (
            <p className="rounded-xl bg-brand-light p-3 text-base text-brand-dark">
              <strong>Pourquoi ici :</strong> {sel.reason}
            </p>
          )}
          {sel.suggested && (sel.kind === "ui" || sel.kind === "ue") && (
            <Button type="button" variant="secondary" full onClick={() => another(sel)}>
              🔄 Autre proposition
            </Button>
          )}
          {sel.kind === "ui" && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <Button type="button" variant="secondary" onClick={() => patch(sel.id, { angle: (((sel.angle ?? 0) - 45) % 360 + 360) % 360 })}>
                  ⟲ Soufflage
                </Button>
                <Button type="button" variant="secondary" onClick={() => patch(sel.id, { angle: ((sel.angle ?? 0) + 45) % 360 })}>
                  ⟳ Soufflage
                </Button>
              </div>
              <Select
                label="Hauteur de pose (surface minimale R32)"
                value={String(sel.poseHeightM ?? INSTALL_HEIGHT_M[indoors.find((i) => i.key === sel.equipmentKey)?.product.type ?? "ui_murale"] ?? 1.8)}
                onChange={(v) => patch(sel.id, { poseHeightM: Number(v) })}
                options={POSE_HEIGHTS.map((h) => ({ value: String(h.value), label: h.label }))}
                hint={R32_WARNING}
              />
              <Field label="Distance sous le plafond" inputMode="numeric" suffix="cm" value={sel.gapCm === undefined ? "" : String(sel.gapCm)} onChange={(v) => patch(sel.id, { gapCm: v.trim() === "" ? undefined : Math.max(0, Math.min(200, Math.round(parseDecimal(v) ?? 0))) })} hint="Selon la notice du fabricant" />
            </>
          )}
          {sel.kind === "ue" && <Select label="Pose" value={sel.mount ?? "sol"} onChange={(v) => patch(sel.id, { mount: v as UeMount })} options={Object.entries(MOUNTS).map(([value, label]) => ({ value, label }))} />}
          {sel.kind === "evacuation" && <Field label="Hauteur de l'entrée d'eau au-dessus du sol" inputMode="decimal" suffix="m" value={decimalToInput(sel.heightM ?? null)} placeholder="0,5" onChange={(v) => patch(sel.id, { heightM: parseDecimal(v) ?? undefined })} hint="Sert à vérifier la pente des condensats" />}
          {(sel.kind === "ue" || (sel.kind === "ui" && indoors.find((i) => i.key === sel.equipmentKey)?.product.type === "ui_murale")) && (
            <Select
              label="Support vérifié sur place (obligatoire)"
              value={sel.support ?? ""}
              onChange={(v) => {
                const support = v === "" ? undefined : (v as SupportKind);
                patch(sel.id, { support, ...(sel.kind === "ue" && support === "console_sol" ? { mount: "sol" as const } : {}), ...(sel.kind === "ue" && support === "toiture" ? { mount: "toiture" as const } : {}) });
              }}
              options={[{ value: "", label: "— À vérifier —" }, ...(sel.kind === "ue" ? SUPPORTS_UE : SUPPORTS_UI).map((k) => ({ value: k, label: SUPPORT_LABELS[k] }))]}
              hint="La fourniture correspondante est ajoutée au devis (kit chevilles chimiques, fixation ITE, console, support toiture)."
            />
          )}
          {(sel.kind === "ui" || sel.kind === "ue") &&
            (["degagements", ...(sel.kind === "ue" ? ["sol_degage", "acces"] : [])] as const).map((c) => (
              <label key={c} className="flex items-start gap-3 text-base">
                <input
                  type="checkbox"
                  className="mt-1 h-6 w-6"
                  checked={sel.confirmed?.includes(c) ?? false}
                  onChange={(e) => patch(sel.id, { confirmed: e.target.checked ? [...(sel.confirmed ?? []), c] : (sel.confirmed ?? []).filter((x) => x !== c) })}
                />
                {c === "degagements" ? "Dégagements de la notice vérifiés sur place (plafond, murs, devant l'unité)" : c === "sol_degage" ? "Sol dégagé devant l'unité vérifié sur place" : "Accès sûr pour l'entretien vérifié"}
              </label>
            ))}
          <FindingList findings={byElement(sel.id)} forceText={forceText} setForceText={setForceText} force={force} unforce={unforce} />
          <button
            type="button"
            className="text-base font-bold text-danger underline"
            onClick={() => {
              setLayout({ ...layout, markers: layout.markers.filter((x) => x.id !== sel.id) });
              setSelected(null);
            }}
          >
            Retirer du plan
          </button>
        </Card>
      )}

      {signedQuote && red.length > 0 && (
        <Notice>
          Devis signé : {red.length} point{red.length > 1 ? "s" : ""} à compléter (rappel, ne bloque ni le devis ni la validation).
        </Notice>
      )}
      <Card title={`Contrôles : ${red.length} ${signedQuote ? "à compléter" : "à corriger"} · ${findings.filter((f) => f.severity === "orange" || f.autoFix).length} conseil(s)`}>
        {findings.length === 0 ? (
          <Notice tone="ok">Aucune alerte sur cette implantation.</Notice>
        ) : (
          <FindingList
            findings={findings}
            forceText={forceText}
            setForceText={setForceText}
            force={force}
            unforce={unforce}
            onShow={(id) => {
              if (layout.markers.some((m) => m.id === id)) setSelected(id);
            }}
          />
        )}
        <p className="text-sm text-slate-600">Rouge : impératif (à corriger, ou à forcer avec un motif). Orange : conseil. Règles réglables dans Paramètres › Règles d&apos;implantation. La notice du fabricant prime toujours.</p>
      </Card>

      <Card title="Tracés et longueurs">
        {layout.routes.length === 0 && <p className="text-base text-slate-600">Aucun : utilisez « Tracer ».</p>}
        <ul className="space-y-3">
          {layout.routes.map((r) => (
            <li key={r.id} className="rounded-xl border-2 border-slate-200 p-3">
              <p className="text-base font-bold" style={{ color: ROUTE_COLORS[r.kind] }}>
                {ROUTE_LABELS[r.kind]} {tags.indoor.get(r.equipmentKey) ?? tags.outdoor.get(r.equipmentKey)} · {mPerPx ? fmtM(routeLengthM(r, mPerPx)) : "échelle inconnue"}
              </p>
              <div className="grid grid-cols-[1fr_auto] items-end gap-2">
                <Field label="Supplément (montées, passage d'étage…)" inputMode="decimal" suffix="m" value={decimalToInput(r.extraM || null)} onChange={(v) => setLayout({ ...layout, routes: layout.routes.map((x) => (x.id === r.id ? { ...x, extraM: Math.max(0, Math.min(50, parseDecimal(v) ?? 0)) } : x)) })} />
                <button type="button" className="min-h-14 rounded-xl border-2 border-slate-300 px-3 font-bold" aria-label="Supprimer ce tracé" onClick={() => setLayout({ ...layout, routes: layout.routes.filter((x) => x.id !== r.id) })}>
                  ✕
                </button>
              </div>
            </li>
          ))}
        </ul>
      </Card>

      {msg && <Notice tone={msg.ok ? "ok" : "danger"}>{msg.text}</Notice>}
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
            <ul className="list-disc pl-6 text-base text-slate-700">
              {result.todo.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          )}
          <LinkButton href={`/app/devis/${quoteId}?etape=5`} full>
            Voir le métré
          </LinkButton>
        </Card>
      )}
      <div className="flex flex-col gap-3">
        <Button type="button" variant="secondary" full disabled={busy} onClick={() => save(false)}>
          {busy ? "Enregistrement…" : "Enregistrer (brouillon)"}
        </Button>
        <Button type="button" full disabled={busy || blockers.length > 0} onClick={() => save(true)}>
          {blockers.length > 0 ? `Valider : ${red.length} règle${red.length > 1 ? "s" : ""} impérative${red.length > 1 ? "s" : ""} à traiter` : "Valider l'implantation"}
        </Button>
        {validatedAt && !result && <p className="text-center text-sm text-slate-600">Implantation validée le {new Date(validatedAt).toLocaleDateString("fr-FR")}. Toute modification demande une nouvelle validation.</p>}
      </div>
    </div>
  );
}

function FindingList({ findings, forceText, setForceText, force, unforce, onShow }: { findings: Finding[]; forceText: Record<string, string>; setForceText: (v: Record<string, string>) => void; force: (f: Finding) => void; unforce: (f: Finding) => void; onShow?: (id: string) => void }) {
  if (findings.length === 0) return null;
  const order = (f: Finding) => (f.severity === "rouge" && !f.forcedReason && !f.autoFix ? 0 : f.severity === "rouge" ? 1 : 2);
  return (
    <ul className="space-y-2">
      {[...findings]
        .sort((a, b) => order(a) - order(b))
        .map((f) => {
          const key = `${f.ruleId}|${f.elementId}`;
          const redOpen = f.severity === "rouge" && !f.forcedReason && !f.autoFix;
          return (
            <li key={key + f.message} className={`rounded-xl border-2 p-3 text-base ${redOpen ? "border-danger bg-danger-light" : f.forcedReason ? "border-slate-300 bg-slate-50" : "border-amber-400 bg-amber-50"}`}>
              <p className={redOpen ? "font-bold text-danger" : ""}>
                {redOpen ? "⛔ " : f.forcedReason ? "✔ Forcé : " : "⚠ "}
                {f.message}
                {onShow && (
                  <button type="button" className="ml-2 text-sm font-bold text-brand underline" onClick={() => onShow(f.elementId)}>
                    Voir
                  </button>
                )}
              </p>
              {f.forcedReason && (
                <p className="text-sm text-slate-700">
                  Motif : {f.forcedReason}{" "}
                  <button type="button" className="font-bold underline" onClick={() => unforce(f)}>
                    Annuler
                  </button>
                </p>
              )}
              {redOpen && (
                <div className="mt-2 grid grid-cols-[1fr_auto] items-end gap-2">
                  <Field label="Forcer : motif obligatoire" value={forceText[key] ?? ""} onChange={(v) => setForceText({ ...forceText, [key]: v })} placeholder="Ex. : notice du fabricant, modèle adapté…" />
                  <Button type="button" variant="secondary" onClick={() => force(f)}>
                    Forcer
                  </Button>
                </div>
              )}
            </li>
          );
        })}
    </ul>
  );
}
