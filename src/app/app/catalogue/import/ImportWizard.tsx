"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { Button, Card, Choice, Field, LinkButton, Notice, Select } from "@/components/ui";
import { formatEuros, formatPercent } from "@/lib/format";
import { ACCESSORY_CATEGORIES } from "@/lib/catalog/forms";
import {
  BIG_INCREASE,
  cellText,
  parseDiscount,
  parseKw,
  parsePriceCents,
  parseProductType,
  detectHeaderRow,
  FIELDS,
  guessMapping,
  parseCsv,
  PRODUCT_TYPE_LABELS,
  projectRows,
  validateMapping,
  type Cell,
  type ImportDefaults,
  type ImportTarget,
  type Mapping,
  type ProductType,
} from "@/lib/catalog/import";
import { reviewRowsToTable, type ReviewRow } from "@/lib/suppliers/pdf-tariff";
import { commitImport, previewImport, type ImportRequest, type PreviewResult } from "./actions";
import { PdfImport } from "./PdfImport";

interface SupplierOpt {
  id: string;
  name: string;
  mapping: Partial<Record<ImportTarget, Mapping>>;
}

const NEW_SUPPLIER = "__nouveau__";

async function readFile(file: File): Promise<Cell[][]> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".xlsx")) {
    const { readSheet } = await import("read-excel-file/browser");
    return (await readSheet(file)) as Cell[][];
  }
  if (name.endsWith(".csv") || name.endsWith(".txt")) {
    const buf = await file.arrayBuffer();
    // UTF-8 d'abord ; si caractères invalides, encodage Windows (Excel FR « CSV point-virgule »)
    let text = new TextDecoder("utf-8").decode(buf);
    if (text.includes("�")) text = new TextDecoder("windows-1252").decode(buf);
    return parseCsv(text);
  }
  throw new Error(name.endsWith(".xls") ? "Ancien format .xls : ouvrez le fichier dans Excel et enregistrez-le en .xlsx." : "Format non reconnu : choisissez un fichier .xlsx, .csv ou .pdf.");
}

async function fileHash(file: File): Promise<string | null> {
  try {
    const d = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}

const serialize = (c: Cell): string | number | null => (c === null || c === undefined ? null : typeof c === "number" ? c : cellText(c));

export function ImportWizard({ initialTarget, suppliers, brands }: { initialTarget: ImportTarget; suppliers: SupplierOpt[]; brands: string[] }) {
  const [step, setStep] = useState<1 | "pdf" | 2 | 3 | 4>(1);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [source, setSource] = useState<"tableur" | "pdf">("tableur");
  const [hash, setHash] = useState<string | null>(null);
  const [target, setTarget] = useState<ImportTarget>(initialTarget);
  const [supplierChoice, setSupplierChoice] = useState(suppliers[0]?.id ?? NEW_SUPPLIER);
  const [newSupplier, setNewSupplier] = useState("");
  const [file, setFile] = useState<{ name: string; table: Cell[][] } | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [headerIndex, setHeaderIndex] = useState(0);
  const [mapping, setMapping] = useState<Mapping>({});
  const [defaults, setDefaults] = useState<ImportDefaults>({});
  const [problems, setProblems] = useState<string[]>([]);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [done, setDone] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, start] = useTransition();

  const chosen = suppliers.find((s) => s.id === supplierChoice);
  const supplierName = supplierChoice === NEW_SUPPLIER ? newSupplier.trim() : (chosen?.name ?? "");
  const remembered = source === "pdf" ? undefined : chosen?.mapping[target];
  const headers = useMemo(() => (file ? (file.table[headerIndex] ?? []).map(cellText) : []), [file, headerIndex]);
  const sample = (col?: string): Cell => {
    if (!file || !col) return null;
    const i = headers.indexOf(col);
    const row = file.table.slice(headerIndex + 1).find((r) => cellText(r[i]) !== "");
    return row ? row[i] : null;
  };
  /** Exemple de la colonne ET la façon dont il sera compris. */
  const interpret = (field: string, c: Cell): string => {
    const raw = typeof c === "number" ? c.toLocaleString("fr-FR") : cellText(c);
    if (raw === "") return "Exemple : (vide)";
    let read: string | null = null;
    if (field === "public_price") {
      const p = parsePriceCents(c);
      read = p === null ? "illisible" : formatEuros(p);
    } else if (field === "discount") {
      const d = parseDiscount(c);
      read = d === "invalid" ? "illisible" : d === null ? null : formatPercent(d);
    } else if (field === "cooling_kw" || field === "heating_kw") {
      const k = parseKw(c);
      read = k === null ? "illisible" : `${k.toLocaleString("fr-FR")} kW`;
    } else if (field === "type") {
      const t = parseProductType(c);
      read = t ? PRODUCT_TYPE_LABELS[t] : "type non reconnu";
    }
    return `Exemple : ${raw}${read && read !== raw ? ` → lu comme ${read}` : ""}`;
  };

  async function onFile(f: File) {
    setFileError(null);
    if (f.name.toLowerCase().endsWith(".pdf") || f.type === "application/pdf") {
      setPdfFile(f);
      setFile(null);
      return;
    }
    setPdfFile(null);
    setSource("tableur");
    setHash(await fileHash(f));
    try {
      const table = await readFile(f);
      if (table.length < 2) throw new Error("Le fichier semble vide.");
      const h = detectHeaderRow(table, target);
      setFile({ name: f.name, table });
      setHeaderIndex(h);
      setMapping(guessMapping(table[h] ?? [], target, remembered));
    } catch (e) {
      setFile(null);
      setFileError(e instanceof Error ? e.message : "Lecture du fichier impossible.");
    }
  }

  function request(): ImportRequest {
    const rows = projectRows(file!.table, headerIndex, mapping).map((r) => ({
      line: r.line,
      cells: Object.fromEntries(Object.entries(r.cells).map(([k, v]) => [k, serialize(v)])),
    }));
    return {
      target,
      supplierId: chosen?.id ?? null,
      supplierName,
      filename: file!.name,
      fileHash: hash,
      source,
      mapping,
      defaults,
      rows,
    };
  }

  function onPdfValidated(rows: ReviewRow[], h: string) {
    const { table, mapping: m } = reviewRowsToTable(rows, target);
    setFile({ name: pdfFile!.name, table });
    setHeaderIndex(0);
    setMapping(m);
    setSource("pdf");
    setHash(h);
    setStep(2);
    window.scrollTo({ top: 0 });
  }

  if (step === "pdf" && pdfFile) {
    return <PdfImport file={pdfFile} target={target} onCancel={() => setStep(1)} onValidated={onPdfValidated} />;
  }

  // ----- Étape 1 : fichier ---------------------------------------------------
  if (step === 1) {
    return (
      <div className="space-y-6">
        <Card title="1. Votre fichier">
          <Choice
            label="Que contient le fichier ?"
            value={target}
            onChange={(v) => {
              setTarget(v);
              setFile(null);
              setPdfFile(null);
            }}
            options={[
              { value: "materiel", label: "Matériel", hint: "Unités extérieures et intérieures" },
              { value: "accessoires", label: "Accessoires", hint: "Liaisons, goulottes, supports, pompes…" },
            ]}
          />
          <Select
            label="Fournisseur"
            value={supplierChoice}
            onChange={setSupplierChoice}
            options={[...suppliers.map((s) => ({ value: s.id, label: s.name })), { value: NEW_SUPPLIER, label: "+ Nouveau fournisseur" }]}
            hint="La correspondance des colonnes est mémorisée pour chaque fournisseur"
            placeholder="Choisir…"
          />
          {supplierChoice === NEW_SUPPLIER && <Field label="Nom du fournisseur" value={newSupplier} onChange={setNewSupplier} placeholder="Ex. : distributeur, grossiste…" />}
          <label className="flex min-h-24 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-brand bg-brand-light px-4 text-center text-lg font-bold text-brand">
            {file ? `✔ ${file.name}` : pdfFile ? `✔ ${pdfFile.name}` : "📄 Choisir le fichier (.xlsx, .csv ou .pdf)"}
            {file && <span className="text-base font-normal">{file.table.length} lignes lues · toucher pour changer</span>}
            {pdfFile && <span className="text-base font-normal">Tarif PDF : lecture automatique à l&apos;étape suivante · toucher pour changer</span>}
            <input type="file" accept=".xlsx,.csv,.txt,.pdf,text/csv,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
          </label>
          {fileError && <Notice tone="danger">{fileError}</Notice>}
          <p className="text-base text-slate-600">Excel : seule la première feuille est lue. Tarif uniquement en PDF : il est lu automatiquement (quota de pages par mois selon votre formule) ; le tarif Excel / CSV reste gratuit et illimité.</p>
          <a href={`/app/catalogue/modele/${target}`} className="block text-lg font-bold text-brand underline underline-offset-4">
            Télécharger le modèle {target === "materiel" ? "matériel" : "accessoires"} (CSV pour Excel)
          </a>
        </Card>
        <Button type="button" full disabled={(!file && !pdfFile) || !supplierName} onClick={() => setStep(pdfFile ? "pdf" : 2)}>
          {pdfFile ? "Suivant : choisir les pages" : "Suivant : les colonnes"}
        </Button>
        {(file || pdfFile) && !supplierName && <p className="text-center text-base text-danger">Indiquez le fournisseur.</p>}
      </div>
    );
  }

  // ----- Étape 2 : correspondance des colonnes -------------------------------
  if (step === 2 && file) {
    const fields = FIELDS[target];
    const headerOptions = file.table.slice(0, 15).map((r, i) => ({ value: String(i), label: `Ligne ${i + 1} : ${r.map(cellText).filter(Boolean).join(" | ").slice(0, 60)}` }));
    return (
      <div className="space-y-6">
        <Card title="2. Quelle colonne contient quoi ?">
          {remembered && <Notice tone="ok">Correspondance de « {supplierName} » reprise du dernier import.</Notice>}
          {source === "pdf" && <Notice tone="ok">Colonnes issues de la lecture du PDF : déjà associées.</Notice>}
          <Select
            label="Ligne des titres de colonnes"
            value={String(headerIndex)}
            onChange={(v) => {
              const i = Number(v);
              setHeaderIndex(i);
              setMapping(guessMapping(file.table[i] ?? [], target, remembered));
            }}
            options={headerOptions}
            placeholder="Choisir…"
          />
          {fields.map((f) => (
            <div key={f.key}>
              <Select
                label={`${f.label}${f.required ? " *" : ""}`}
                value={mapping[f.key] ?? ""}
                onChange={(v) => setMapping({ ...mapping, [f.key]: v || undefined })}
                options={headers.filter(Boolean).map((h) => ({ value: h, label: h }))}
                placeholder={f.required ? "Choisir la colonne…" : "— Pas dans le fichier —"}
                hint={mapping[f.key] ? interpret(f.key, sample(mapping[f.key])) : f.hint}
              />
            </div>
          ))}
        </Card>
        {target === "materiel" && (!mapping.brand || !mapping.type) && (
          <Card title="Valeurs pour tout le fichier">
            {!mapping.brand && (
              <Field label="Marque de tous les produits" value={defaults.brand ?? ""} onChange={(v) => setDefaults({ ...defaults, brand: v })} list="brands-list" hint="Choisissez une marque existante ou tapez-en une nouvelle" />
            )}
            <datalist id="brands-list">
              {brands.map((b) => (
                <option key={b} value={b} />
              ))}
            </datalist>
            {!mapping.type && (
              <Select
                label="Type de tous les produits"
                value={defaults.type ?? ""}
                onChange={(v) => setDefaults({ ...defaults, type: (v || undefined) as ProductType | undefined })}
                options={Object.entries(PRODUCT_TYPE_LABELS).map(([value, label]) => ({ value, label }))}
              />
            )}
          </Card>
        )}
        {target === "accessoires" && !mapping.category && (
          <Card title="Valeurs pour tout le fichier">
            <Select label="Catégorie de tous les accessoires" value={defaults.category ?? ""} onChange={(v) => setDefaults({ ...defaults, category: v || undefined })} options={Object.entries(ACCESSORY_CATEGORIES).map(([value, label]) => ({ value, label }))} placeholder="Autres" />
          </Card>
        )}
        {problems.length > 0 && (
          <Notice tone="danger">
            <ul className="list-disc pl-5">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </Notice>
        )}
        <div className="flex flex-col-reverse gap-3 sm:flex-row">
          <Button type="button" variant="secondary" onClick={() => setStep(source === "pdf" ? "pdf" : 1)} disabled={pending}>
            Précédent
          </Button>
          <Button
            type="button"
            full
            disabled={pending}
            onClick={() => {
              const local = validateMapping(mapping, target, defaults);
              setProblems(local);
              if (local.length) return;
              start(async () => {
                const r = await previewImport(request());
                if (!r.ok) setProblems(r.problems ?? ["Vérification impossible."]);
                else {
                  setPreview(r);
                  setStep(3);
                  window.scrollTo({ top: 0 });
                }
              });
            }}
          >
            {pending ? "Analyse du fichier…" : "Voir le résumé"}
          </Button>
        </div>
      </div>
    );
  }

  // ----- Étape 3 : résumé avant validation -----------------------------------
  if (step === 3 && preview?.summary) {
    const s = preview.summary;
    const item = target === "materiel" ? "produit" : "accessoire";
    const tiles: { label: string; value: number; tone?: "danger" | "ok" }[] = [
      { label: "prix modifiés", value: s.priceChanges },
      { label: `nouveaux ${item}s`, value: s.newItems, tone: "ok" },
      {
        label: "déjà au catalogue, nouveaux chez ce fournisseur",
        value: s.newOffers,
        tone: "ok",
      },
      {
        label: "correspondances probables à confirmer",
        value: s.probable,
        tone: s.probable ? "danger" : undefined,
      },
      {
        label: `hausses de plus de ${formatPercent(BIG_INCREASE, 0)}`,
        value: s.bigIncreases,
        tone: s.bigIncreases ? "danger" : undefined,
      },
      { label: "baisses de prix", value: s.decreases },
      { label: "remises modifiées", value: s.discountChanges },
      { label: "inchangés", value: s.unchanged },
    ];
    return (
      <div className="space-y-6">
        <Card title="3. Résumé avant validation">
          <p className="text-base text-slate-700">
            {file?.name} · fournisseur {supplierName}
          </p>
          <div className="grid grid-cols-2 gap-3">
            {tiles.map((t) => (
              <div key={t.label} className={`rounded-xl border-2 p-3 ${t.tone === "danger" ? "border-danger bg-danger-light" : t.tone === "ok" && t.value ? "border-ok bg-ok-light" : "border-slate-300 bg-slate-50"}`}>
                <p className={`text-3xl font-extrabold ${t.tone === "danger" ? "text-danger" : ""}`}>{t.value}</p>
                <p className="text-base font-semibold">{t.label}</p>
              </div>
            ))}
          </div>
          {preview.alreadyImportedAt && <Notice tone="danger">Ce même fichier a déjà été importé chez ce fournisseur le {new Date(preview.alreadyImportedAt).toLocaleDateString("fr-FR")}.</Notice>}
          {(preview.newBrands?.length ?? 0) > 0 && <Notice>Nouvelles marques créées : {preview.newBrands!.join(", ")} (remises à régler dans Fournisseurs).</Notice>}
          <p className="text-base text-slate-700">
            Les remises que vous avez saisies sont conservées quand le fichier n&apos;en contient pas. Les anciens prix sont gardés dans l&apos;historique. Un article déjà connu chez un autre fournisseur (même EAN ou même référence) reçoit simplement
            un tarif de plus : le moins cher sera retenu dans vos devis.
          </p>
        </Card>

        {(preview.priceChanges?.length ?? 0) > 0 && (
          <Card title="Changements de prix">
            <ul className="divide-y-2 divide-slate-200">
              {preview.priceChanges!.map((c) => (
                <li key={c.id} className={`py-3 ${c.change > BIG_INCREASE ? "-mx-2 rounded-lg bg-danger-light px-2" : ""}`}>
                  <p className="font-bold">{c.label}</p>
                  <p className="text-base">
                    {formatEuros(c.oldPriceCents)} → <strong>{formatEuros(c.newPriceCents)}</strong>{" "}
                    <span className={`font-bold ${c.change > 0 ? "text-danger" : "text-ok"}`}>
                      ({c.change > 0 ? "+" : ""}
                      {formatPercent(c.change)})
                    </span>
                  </p>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {(preview.probable?.length ?? 0) > 0 && (
          <Card title="Correspondances probables (à confirmer après l'import)">
            <p className="text-base text-slate-700">Références presque identiques (suffixe différent). Elles ne sont pas utilisées dans les prix tant que vous ne les avez pas confirmées dans Fournisseurs.</p>
            <ul className="divide-y-2 divide-slate-200">
              {preview.probable!.map((m) => (
                <li key={m.line} className="py-2 text-base">
                  <strong>{m.label}</strong> (ligne {m.line}) ≈ {m.candidateLabel}
                </li>
              ))}
            </ul>
          </Card>
        )}

        {(preview.errors?.length ?? 0) > 0 && (
          <Card title={`${s.errors} ligne(s) ignorée(s)`}>
            <ul className="space-y-2 text-base">
              {preview.errors!.map((e) => (
                <li key={`${e.line}-${e.message}`}>
                  <strong>Ligne {e.line}</strong> : {e.message}
                </li>
              ))}
            </ul>
          </Card>
        )}

        {done && <Notice tone={done.ok ? "ok" : "danger"}>{done.message}</Notice>}
        <div className="flex flex-col-reverse gap-3 sm:flex-row">
          <Button type="button" variant="secondary" onClick={() => setStep(2)} disabled={pending}>
            Précédent
          </Button>
          <Button
            type="button"
            full
            disabled={pending || s.newItems + s.newOffers + s.probable + s.priceChanges + s.discountChanges === 0}
            onClick={() =>
              start(async () => {
                const r = await commitImport(request());
                setDone(r);
                if (r.ok) setStep(4);
              })
            }
          >
            {pending ? "Import en cours…" : s.newItems + s.newOffers + s.probable + s.priceChanges + s.discountChanges === 0 ? "Rien à importer" : "Valider l'import"}
          </Button>
        </div>
      </div>
    );
  }

  // ----- Étape 4 : terminé ---------------------------------------------------
  return (
    <div className="space-y-6">
      <Notice tone="ok">{done?.message ?? "Import terminé."}</Notice>
      <LinkButton href={`/app/catalogue?onglet=${target}`} full>
        Voir le catalogue
      </LinkButton>
      <Link href={`/app/catalogue/import?cible=${target}`} className="block text-center text-lg font-bold text-brand underline" onClick={() => window.location.reload()}>
        Importer un autre fichier
      </Link>
    </div>
  );
}
