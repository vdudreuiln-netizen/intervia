"use client";

import { useRef, useState } from "react";
import { Button, Card, Field, Notice } from "@/components/ui";
import { decimalToInput, parseDecimal } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import { DEFAULT_SYSTEM_INPUT, NATURES, NO_CAPACITY_WARNING, type CerfaInput, type CerfaSheet, type CerfaSystemInput, type Nature, type SignatureBlock } from "@/lib/site/cerfa";
import { saveFluidForm } from "../actions";

type Run = (fn: () => Promise<{ ok: boolean; message?: string }>, then?: () => void) => void;

export interface FluidView {
  input: CerfaInput;
  holderSiret: string;
  /** Fiches calculées côté serveur (charge, tonnage, fréquence, alertes), une par unité extérieure. */
  sheets: (CerfaSheet & { systemKey: string })[];
  country: string;
}

const kgText = (n: number | null) => (n === null ? "?" : `${n.toLocaleString("fr-FR", { maximumFractionDigits: 3 })} kg`);
const today = () => new Date().toISOString().slice(0, 10);

function Toggle({ value, onChange, yes = "Oui", no = "Non" }: { value: boolean; onChange: (v: boolean) => void; yes?: string; no?: string }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {[true, false].map((o) => (
        <button key={String(o)} type="button" aria-pressed={value === o} onClick={() => onChange(o)} className={`min-h-12 rounded-xl border-2 text-lg font-bold ${value === o ? "border-brand bg-brand text-white" : "border-slate-300 bg-white"}`}>
          {o ? yes : no}
        </button>
      ))}
    </div>
  );
}

function KgField({ label, value, onChange, hint }: { label: string; value: number; onChange: (v: number) => void; hint?: string }) {
  const [t, setT] = useState(decimalToInput(value));
  return (
    <Field
      label={label}
      inputMode="decimal"
      suffix="kg"
      value={t}
      hint={hint}
      onChange={(v) => {
        setT(v);
        const n = parseDecimal(v || "0");
        if (n !== null && n >= 0) onChange(n);
      }}
    />
  );
}

/** Zone de signature au doigt, déposée dans le stockage privé du chantier. */
function SignaturePad({ label, onSigned, hasSignature }: { label: string; onSigned: (blob: Blob) => Promise<void>; hasSignature: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [dirty, setDirty] = useState(false);
  const [sending, setSending] = useState(false);
  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * canvas.current!.width, y: ((e.clientY - r.top) / r.height) * canvas.current!.height };
  };
  return (
    <div>
      <p className="mb-1 text-base font-bold">
        {label} {hasSignature && !dirty && <span className="text-ok">✔ signée</span>}
      </p>
      <canvas
        ref={canvas}
        width={900}
        height={260}
        className="w-full touch-none rounded-xl border-2 border-slate-400 bg-white"
        aria-label={label}
        onPointerDown={(e) => {
          drawing.current = true;
          const ctx = canvas.current!.getContext("2d")!;
          ctx.lineWidth = 4;
          ctx.lineCap = "round";
          ctx.strokeStyle = "#111827";
          const p = pos(e);
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          const ctx = canvas.current!.getContext("2d")!;
          const p = pos(e);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
          setDirty(true);
        }}
        onPointerUp={() => (drawing.current = false)}
        onPointerLeave={() => (drawing.current = false)}
      />
      <div className="mt-1 flex gap-4">
        <button
          type="button"
          className="text-base font-bold text-brand underline"
          onClick={() => {
            const c = canvas.current!;
            c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
            setDirty(false);
          }}
        >
          Effacer
        </button>
        {dirty && (
          <button
            type="button"
            disabled={sending}
            className="text-base font-bold text-brand underline"
            onClick={async () => {
              setSending(true);
              const blob = await new Promise<Blob | null>((res) => canvas.current!.toBlob(res, "image/png"));
              if (blob) await onSigned(blob);
              setDirty(false);
              setSending(false);
            }}
          >
            {sending ? "Envoi…" : "Utiliser cette signature"}
          </button>
        )}
      </div>
    </div>
  );
}

export function FluidFormTab({ quoteId, companyId, fluid, busy, run, setMsg }: { quoteId: string; companyId: string; fluid: FluidView; busy: boolean; run: Run; setMsg: (m: { ok: boolean; text: string } | null) => void }) {
  const [systems, setSystems] = useState<Record<string, CerfaSystemInput>>(() =>
    Object.fromEntries(fluid.sheets.map((f) => [f.systemKey, { ...DEFAULT_SYSTEM_INPUT, ...(fluid.input.systems?.[f.systemKey] ?? {}) } as CerfaSystemInput])),
  );
  const [siret, setSiret] = useState(fluid.holderSiret);
  const blank = (quality: string): SignatureBlock => ({ name: "", quality, date: today(), signaturePath: null });
  const [op, setOp] = useState<SignatureBlock>(fluid.input.operatorSign ?? blank("Technicien frigoriste"));
  const [holder, setHolder] = useState<SignatureBlock>(fluid.input.holderSign ?? blank("Propriétaire"));
  const official = fluid.country === "FR";
  const patch = (key: string, p: Partial<CerfaSystemInput>) => setSystems((s) => ({ ...s, [key]: { ...s[key]!, ...p } }));

  async function upload(who: "op" | "holder", blob: Blob) {
    const path = `${companyId}/${quoteId}/cerfa-${who}-${Date.now()}.png`;
    const { error } = await createClient().storage.from("chantier").upload(path, blob, { contentType: "image/png" });
    if (error) return setMsg({ ok: false, text: "Envoi de la signature impossible. Vérifiez votre connexion." });
    if (who === "op") setOp((b) => ({ ...b, signaturePath: path }));
    else setHolder((b) => ({ ...b, signaturePath: path }));
    setMsg({ ok: true, text: "Signature prête : pensez à enregistrer la fiche." });
  }

  const save = () => run(() => saveFluidForm(quoteId, { systems, operatorSign: op, holderSign: holder, holderSiret: siret }));

  return (
    <div className="space-y-5">
      <Notice>
        {official
          ? "Formulaire officiel CERFA 15497*04, pré-rempli depuis le devis, le catalogue, la mise en service et vos paramètres. Vérifiez puis faites signer."
          : "Fiche d'intervention générique (règlement (UE) 2024/573) : le CERFA 15497*04 ne s'applique qu'en France (pays du compte, Paramètres › Règles d'implantation et fiche fluides)."}
      </Notice>
      {fluid.sheets.some((f) => f.warnings.includes(NO_CAPACITY_WARNING)) && <Notice tone="danger">⚠ {NO_CAPACITY_WARNING}</Notice>}

      {fluid.sheets.map((f) => {
        const s = systems[f.systemKey]!;
        const recovered = s.recoveredTreatmentKg + s.recoveredReuseKg > 0;
        return (
          <Card key={f.systemKey} title={`${f.tag} · ${f.equipment.brand} ${f.equipment.model} · fiche n° ${f.number}`}>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-base">
              <dt className="text-slate-600">N° de série</dt>
              <dd className="font-bold">{f.equipment.serial || <span className="text-danger">à saisir (Mise en service)</span>}</dd>
              <dt className="text-slate-600">Fluide</dt>
              <dd className="font-bold">{f.equipment.fluid}</dd>
              <dt className="text-slate-600">Charge totale</dt>
              <dd className="font-bold">
                {kgText(f.equipment.totalChargeKg)} <span className="font-normal text-slate-600">(usine {kgText(f.equipment.factoryChargeKg)} + complément {kgText(f.equipment.complementKg)})</span>
              </dd>
              <dt className="text-slate-600">Tonnage éq. CO2</dt>
              <dd className="font-bold">{f.equipment.teq === null ? "?" : `${f.equipment.teq.toLocaleString("fr-FR")} t (PRG ${f.equipment.prg})`}</dd>
            </dl>
            <p className="rounded-xl bg-slate-100 p-3 text-base font-semibold">[7]–[9] {f.leakCheckText}</p>
            {f.warnings
              .filter((w) => w !== NO_CAPACITY_WARNING)
              .map((w) => (
                <Notice key={w}>⚠ {w}</Notice>
              ))}

            <fieldset>
              <legend className="mb-1 text-base font-bold">[4] Nature de l&apos;intervention</legend>
              <div className="grid gap-1">
                {(Object.keys(NATURES) as Nature[]).map((n) => (
                  <label key={n} className="flex items-center gap-3 text-base">
                    <input type="checkbox" className="h-6 w-6" checked={s.natures.includes(n)} onChange={(e) => patch(f.systemKey, { natures: e.target.checked ? [...s.natures, n] : s.natures.filter((x) => x !== n) })} />
                    {NATURES[n]}
                  </label>
                ))}
              </div>
              {s.natures.includes("autre") && <Field label="Préciser" value={s.natureOther} onChange={(v) => patch(f.systemKey, { natureOther: v })} />}
            </fieldset>

            <div>
              <p className="mb-1 text-base font-bold">[6] Système de détection permanente des fuites</p>
              <Toggle value={s.permanentDetection} onChange={(v) => patch(f.systemKey, { permanentDetection: v })} />
            </div>

            <div>
              <p className="mb-1 text-base font-bold">[10] Fuites constatées</p>
              <Toggle value={s.leaksFound} onChange={(v) => patch(f.systemKey, { leaksFound: v, leaks: v && s.leaks.length === 0 ? [{ location: "", repaired: true }] : s.leaks })} />
              {s.leaksFound &&
                s.leaks.map((l, i) => (
                  <div key={i} className="mt-2 rounded-xl border-2 border-slate-200 p-2">
                    <Field label={`Fuite ${i + 1} : localisation`} value={l.location} onChange={(v) => patch(f.systemKey, { leaks: s.leaks.map((x, j) => (j === i ? { ...x, location: v } : x)) })} />
                    <Toggle value={l.repaired} yes="Réparation réalisée" no="Réparation à faire" onChange={(v) => patch(f.systemKey, { leaks: s.leaks.map((x, j) => (j === i ? { ...x, repaired: v } : x)) })} />
                  </div>
                ))}
              {s.leaksFound && s.leaks.length < 3 && (
                <button type="button" className="mt-2 text-base font-bold text-brand underline" onClick={() => patch(f.systemKey, { leaks: [...s.leaks, { location: "", repaired: true }] })}>
                  + Ajouter une fuite (3 maximum)
                </button>
              )}
            </div>

            <fieldset className="space-y-2">
              <legend className="text-base font-bold">[11] Fluide chargé</legend>
              <KgField label="A – fluide vierge" value={s.chargedVirginKg ?? f.equipment.complementKg ?? 0} onChange={(v) => patch(f.systemKey, { chargedVirginKg: v })} hint="Par défaut : complément de charge" />
              <KgField label="B – fluide recyclé" value={s.chargedRecycledKg} onChange={(v) => patch(f.systemKey, { chargedRecycledKg: v })} />
              <KgField label="C – fluide régénéré" value={s.chargedRegeneratedKg} onChange={(v) => patch(f.systemKey, { chargedRegeneratedKg: v })} />
              <p className="text-base font-bold">Total A + B + C : {kgText((s.chargedVirginKg ?? f.equipment.complementKg ?? 0) + s.chargedRecycledKg + s.chargedRegeneratedKg)}</p>
            </fieldset>
            <fieldset className="space-y-2">
              <legend className="text-base font-bold">[11] Fluide récupéré</legend>
              <KgField label="D – destiné au traitement" value={s.recoveredTreatmentKg} onChange={(v) => patch(f.systemKey, { recoveredTreatmentKg: v })} />
              <KgField label="E – conservé pour réutilisation" value={s.recoveredReuseKg} onChange={(v) => patch(f.systemKey, { recoveredReuseKg: v })} />
              <p className="text-base font-bold">Total D + E : {kgText(s.recoveredTreatmentKg + s.recoveredReuseKg)}</p>
              {s.recoveredTreatmentKg > 0 && <Field label="N° de BSFF (Trackdéchets)" value={s.bsff} onChange={(v) => patch(f.systemKey, { bsff: v })} />}
            </fieldset>
            {recovered && (
              <fieldset className="space-y-2">
                <legend className="text-base font-bold">[13] Installation de destination du fluide récupéré</legend>
                <Field label="Nom" value={s.destinationName} onChange={(v) => patch(f.systemKey, { destinationName: v })} />
                <Field label="Adresse" value={s.destinationAddress} onChange={(v) => patch(f.systemKey, { destinationAddress: v })} />
                <p className="text-sm text-slate-600">[12] rempli automatiquement selon le fluide (inflammable : UN 3161, déchet 16 05 04* ; sinon UN 1078, 14 06 01*).</p>
              </fieldset>
            )}
            <Field label="[14] Observations" value={s.observations} onChange={(v) => patch(f.systemKey, { observations: v })} />
          </Card>
        );
      })}

      <Card title="[2] Détenteur">
        <Field label="SIRET du détenteur" inputMode="numeric" value={siret} onChange={setSiret} hint="Facultatif pour un particulier" />
      </Card>

      <Card title="Signatures">
        {(
          [
            ["op", "Opérateur", op, setOp],
            ["holder", "Détenteur", holder, setHolder],
          ] as const
        ).map(([who, title, b, set]) => (
          <div key={who} className="space-y-2 rounded-xl border-2 border-slate-200 p-3">
            <p className="text-lg font-bold">{title}</p>
            <Field label="Nom" value={b.name} onChange={(v) => set({ ...b, name: v })} />
            <Field label="Qualité" value={b.quality} onChange={(v) => set({ ...b, quality: v })} />
            <Field label="Date" type="date" value={b.date} onChange={(v) => set({ ...b, date: v })} />
            <SignaturePad label={`Signature – ${title.toLowerCase()}`} hasSignature={Boolean(b.signaturePath)} onSigned={(blob) => upload(who, blob)} />
          </div>
        ))}
      </Card>

      <Button type="button" full disabled={busy} onClick={save}>
        {busy ? "Enregistrement…" : "Enregistrer la fiche"}
      </Button>
      <a href={`/app/chantiers/${quoteId}/fluides`} target="_blank" rel="noopener" className="flex min-h-14 items-center justify-center rounded-xl bg-brand px-4 text-center text-lg font-bold text-white">
        {official ? "CERFA 15497*04 pré-rempli (PDF)" : "Fiche d'intervention (PDF)"}
      </a>
      {fluid.sheets.some((f) => f.reminder) && <p className="text-sm text-slate-600">Le détenteur conserve l&apos;original au moins 5 ans (charge ≥ 5 t éq. CO2).</p>}
    </div>
  );
}
