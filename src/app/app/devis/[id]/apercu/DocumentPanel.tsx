"use client";

import { SHARE_MODES, type ShareMode } from "@/lib/plans/annex";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Choice, Field, Notice, PercentField } from "@/components/ui";
import { decimalToInput, parsePercent } from "@/lib/format";
import { validateSchedule, type ScheduleItem } from "@/lib/pdf/document";
import { setDocumentOptions, setQuoteStatus, type DocumentOptions } from "../../actions";
import { Check } from "../steps/ClientStep";

const DEFAULT_SCHEDULE: ScheduleItem[] = [
  { label: "Acompte", rate: 0.3 },
  { label: "À la livraison du matériel", rate: 0.4 },
  { label: "Solde à la fin des travaux", rate: 0.3 },
];

export function DocumentPanel({ quoteId, options, companyDepositRate }: { quoteId: string; options: DocumentOptions; companyDepositRate: number }) {
  const router = useRouter();
  const [o, setO] = useState(options);
  const [deposit, setDeposit] = useState(o.depositRate === null ? "" : decimalToInput(Math.round(o.depositRate * 1000) / 10));
  const [rows, setRows] = useState(o.schedule?.map((s) => ({ label: s.label, rate: decimalToInput(Math.round(s.rate * 1000) / 10) })) ?? null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const schedule: ScheduleItem[] | null = rows ? rows.map((r) => ({ label: r.label, rate: parsePercent(r.rate) ?? 0 })) : null;
  const scheduleError = schedule ? validateSchedule(schedule) : null;
  const depositRate = deposit.trim() === "" ? null : parsePercent(deposit);

  return (
    <Card title="Document client">
      <Choice
        label="Présentation"
        value={o.presentation}
        onChange={(v) => setO({ ...o, presentation: v })}
        options={[
          { value: "particulier", label: "Client particulier", hint: "Une ligne « Fourniture » avec le détail, puis main d'œuvre, mise en service, déplacement" },
          { value: "detaille", label: "Détaillé", hint: "Chaque article sur sa ligne avec son prix (assurances, clients exigeants)" },
        ]}
      />
      <Check label="Signé chez le client" hint="Droit de rétractation de 14 jours, formulaire joint, aucun paiement avant 7 jours" checked={o.signedOffPremises} onChange={(v) => setO({ ...o, signedOffPremises: v })} />
      {o.signedOffPremises && !o.urgentRepair && (
        <Check label="Le client demande le démarrage avant la fin des 14 jours" hint="Ajoute sa demande expresse à signer (art. L221-25)" checked={o.earlyStart} onChange={(v) => setO({ ...o, earlyStart: v })} />
      )}
      <Check label="Dépannage urgent demandé par le client" hint="Pas de droit de rétractation pour les réparations strictement nécessaires à l'urgence (art. L221-28, 8°)" checked={o.urgentRepair} onChange={(v) => setO({ ...o, urgentRepair: v })} />
      <Check
        label="Paiement en plusieurs échéances"
        checked={rows !== null}
        onChange={(v) =>
          setRows(
            v
              ? DEFAULT_SCHEDULE.map((s) => ({
                  label: s.label,
                  rate: decimalToInput(s.rate * 100),
                }))
              : null,
          )
        }
      />
      {rows === null ? (
        <PercentField
          label="Acompte"
          value={deposit}
          onChange={setDeposit}
          placeholder={decimalToInput(Math.round(companyDepositRate * 1000) / 10)}
          hint={`Vide = ${decimalToInput(Math.round(companyDepositRate * 1000) / 10)} % (paramètres). Solde à la fin des travaux.`}
          error={deposit && (depositRate === null || depositRate >= 1) ? "Entre 0 et 99 %" : undefined}
        />
      ) : (
        <div className="space-y-3">
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-[1fr_7rem] gap-2">
              <Field label={`Échéance ${i + 1}`} value={r.label} onChange={(v) => setRows(rows.map((x, j) => (j === i ? { ...x, label: v } : x)))} />
              <PercentField label="Part" value={r.rate} onChange={(v) => setRows(rows.map((x, j) => (j === i ? { ...x, rate: v } : x)))} />
            </div>
          ))}
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={() => setRows([...rows, { label: "", rate: "" }])}>
              + Échéance
            </Button>
            {rows.length > 2 && (
              <Button type="button" variant="secondary" onClick={() => setRows(rows.slice(0, -1))}>
                Retirer la dernière
              </Button>
            )}
          </div>
          {scheduleError && <Notice tone="danger">{scheduleError}</Notice>}
          {o.signedOffPremises && !o.urgentRepair && <p className="text-sm text-slate-600">Signé chez le client : la première échéance ne peut être encaissée qu&apos;après 7 jours.</p>}
        </div>
      )}
      {msg && <Notice tone={msg.ok ? "ok" : "danger"}>{msg.text}</Notice>}
      <Button
        type="button"
        full
        disabled={pending || !!scheduleError || (deposit !== "" && (depositRate === null || depositRate >= 1))}
        onClick={() =>
          start(async () => {
            const r = await setDocumentOptions(quoteId, { ...o, depositRate: rows ? null : depositRate, schedule });
            setMsg({ ok: r.ok, text: r.message ?? "" });
            if (r.ok) router.refresh();
          })
        }
      >
        Enregistrer les réglages du document
      </Button>
    </Card>
  );
}

const STATUS_LABELS = { brouillon: "Brouillon", envoye: "Envoyé", accepte: "Accepté", refuse: "Refusé" } as const;
type Status = keyof typeof STATUS_LABELS;

export function SharePanel({ quoteId, number, status, warnings, datasheets = [], hasAnnexes = false }: { quoteId: string; number: string; status: Status; warnings: string[]; datasheets?: { productId: string; name: string }[]; hasAnnexes?: boolean }) {
  const router = useRouter();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const [mode, setMode] = useState<ShareMode>(hasAnnexes || datasheets.length ? "annexes" : "seul");
  const url = `/app/devis/${quoteId}/pdf?mode=${mode}`;
  const fileName = `Devis-${number}${mode === "seul" ? "" : mode === "complet" ? "-dossier-complet" : "-annexes"}.pdf`;

  async function fetchFile(href: string, name: string): Promise<File> {
    const res = await fetch(href);
    if (!res.ok) throw new Error();
    return new File([await res.blob()], name, { type: "application/pdf" });
  }

  async function shareFiles(files: File[], title: string) {
    if (navigator.canShare?.({ files })) {
      await navigator.share({ files, title });
      return;
    }
    for (const file of files) {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(file);
      a.download = file.name;
      a.click();
      URL.revokeObjectURL(a.href);
    }
  }

  async function share() {
    setMsg(null);
    try {
      const files = [await fetchFile(url, fileName)];
      // « Devis + annexes » : fiches techniques en fichiers séparés (le devis reste léger)
      if (mode === "annexes") for (const d of datasheets) files.push(await fetchFile(`/app/devis/${quoteId}/fiche/${d.productId}`, d.name));
      await shareFiles(files, `Devis ${number}`);
    } catch (e) {
      if ((e as Error)?.name !== "AbortError") setMsg({ ok: false, text: "Impossible de préparer le PDF. Vérifiez votre connexion." });
    }
  }

  async function shareSite() {
    setMsg(null);
    try {
      await shareFiles([await fetchFile(`/app/devis/${quoteId}/chantier`, `Chantier-${number}.pdf`)], `Dossier chantier ${number}`);
    } catch (e) {
      if ((e as Error)?.name !== "AbortError") setMsg({ ok: false, text: "Dossier chantier indisponible : choisissez d'abord une solution dans le devis." });
    }
  }
  const setStatus = (s: Status) =>
    start(async () => {
      const r = await setQuoteStatus(quoteId, s);
      setMsg({ ok: r.ok, text: r.message ?? "" });
      if (r.ok) router.refresh();
    });

  return (
    <Card title="Envoi et suivi">
      {warnings.map((w) => (
        <Notice key={w} tone="danger">
          {w}
        </Notice>
      ))}
      <p className="text-lg">
        Statut : <strong>{STATUS_LABELS[status]}</strong>
      </p>
      <Choice
        label="Que partager ?"
        value={mode}
        onChange={setMode}
        options={(Object.keys(SHARE_MODES) as ShareMode[]).map((m) => ({
          value: m,
          label: SHARE_MODES[m].label,
          hint: m === "annexes" && datasheets.length ? `${SHARE_MODES[m].hint} (${datasheets.length})` : m !== "seul" && !hasAnnexes && !datasheets.length ? "Aucune annexe pour l'instant (plan, implantation, fiches techniques)" : SHARE_MODES[m].hint,
        }))}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <a href={url} target="_blank" rel="noopener" className="inline-flex min-h-14 items-center justify-center rounded-xl border-2 border-brand bg-white px-6 text-lg font-bold text-brand">
          Voir le PDF
        </a>
        <Button type="button" onClick={share}>
          Partager
        </Button>
      </div>
      <p className="text-sm text-slate-600">« Partager » ouvre le menu du téléphone : e-mail, WhatsApp, SMS… Puis marquez le devis comme envoyé.</p>
      <div className="rounded-xl border-2 border-slate-300 p-3">
        <p className="text-base font-bold">Dossier chantier (sans prix)</p>
        <p className="text-sm text-slate-600">Pour l&apos;équipe de pose : matériel, longueurs, charge, plan, contrôles.</p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <a href={`/app/devis/${quoteId}/chantier`} target="_blank" rel="noopener" className="inline-flex min-h-12 items-center justify-center rounded-xl border-2 border-brand bg-white px-4 text-base font-bold text-brand">
            Voir
          </a>
          <Button type="button" variant="secondary" onClick={shareSite}>
            Partager
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Button type="button" variant={status === "envoye" ? "primary" : "secondary"} disabled={pending || warnings.length > 0} onClick={() => setStatus("envoye")}>
          Envoyé
        </Button>
        <button type="button" disabled={pending} onClick={() => setStatus("accepte")} className={`min-h-14 rounded-xl border-2 text-lg font-bold ${status === "accepte" ? "border-ok bg-ok text-white" : "border-ok bg-white text-ok"}`}>
          Accepté
        </button>
        <button type="button" disabled={pending} onClick={() => setStatus("refuse")} className={`min-h-14 rounded-xl border-2 text-lg font-bold ${status === "refuse" ? "border-danger bg-danger text-white" : "border-danger bg-white text-danger"}`}>
          Refusé
        </button>
      </div>
      {status !== "brouillon" && (
        <button type="button" className="text-base font-bold text-brand underline" disabled={pending} onClick={() => setStatus("brouillon")}>
          Repasser en brouillon
        </button>
      )}
      {msg && <Notice tone={msg.ok ? "ok" : "danger"}>{msg.text}</Notice>}
    </Card>
  );
}
