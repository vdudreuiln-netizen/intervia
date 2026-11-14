"use server";

import { adminOnlyError } from "@/lib/billing/guard";

import { revalidatePath } from "next/cache";
import { getCurrentCompany } from "@/lib/company/current";
import { fetchAll } from "@/lib/catalog/queries";
import {
  buildPlan,
  MAX_IMPORT_ROWS,
  normalizeAccessoryRows,
  normalizeMaterialRows,
  validateMapping,
  type ExistingItem,
  type ImportDefaults,
  type ImportPlan,
  type ImportTarget,
  type MappedRow,
  type Mapping,
} from "@/lib/catalog/import";

export interface ImportRequest {
  target: ImportTarget;
  supplierName: string;
  filename: string;
  mapping: Mapping;
  defaults: ImportDefaults;
  rows: { line: number; cells: MappedRow }[];
}

export interface PreviewResult {
  ok: boolean;
  problems?: string[];
  summary?: ImportPlan["summary"];
  priceChanges?: ImportPlan["priceChanges"];
  errors?: ImportPlan["errors"];
  newBrands?: string[];
  newSamples?: string[];
}

async function plan(req: ImportRequest) {
  const { supabase } = await getCurrentCompany();
  const problems = validateMapping(req.mapping, req.target, req.defaults);
  if (!req.supplierName.trim()) problems.push("Indiquez le nom du fournisseur");
  if (req.rows.length === 0) problems.push("Aucune ligne de données trouvée dans le fichier");
  if (req.rows.length > MAX_IMPORT_ROWS) problems.push(`Fichier trop gros : ${MAX_IMPORT_ROWS} lignes maximum`);
  if (problems.length) return { supabase, problems, plan: null };

  let existing: ExistingItem[];
  let brandNames: string[] = [];
  let normalized;
  if (req.target === "materiel") {
    normalized = normalizeMaterialRows(req.rows, req.defaults);
    const products = await fetchAll<{ id: string; reference: string; public_price_cents: number; discount_rate: number | null; brands: { name: string } }>((from, to) =>
      supabase.from("products").select("id, reference, public_price_cents, discount_rate, brands(name)").range(from, to) as never,
    );
    existing = products.map((p) => ({
      id: p.id,
      brand: p.brands.name,
      reference: p.reference,
      label: `${p.brands.name} ${p.reference}`,
      public_price_cents: Number(p.public_price_cents),
      discount_rate: p.discount_rate === null ? null : Number(p.discount_rate),
    }));
    const { data } = await supabase.from("brands").select("name");
    brandNames = (data ?? []).map((b) => b.name);
  } else {
    normalized = normalizeAccessoryRows(req.rows, req.defaults);
    const acc = await fetchAll<{ id: string; reference: string; name: string; public_price_cents: number; discount_rate: number }>((from, to) =>
      supabase.from("accessories").select("id, reference, name, public_price_cents, discount_rate").not("reference", "is", null).range(from, to) as never,
    );
    existing = acc.map((a) => ({ id: a.id, reference: a.reference, label: `${a.reference} – ${a.name}`, public_price_cents: Number(a.public_price_cents), discount_rate: Number(a.discount_rate) }));
  }
  return { supabase, problems: [] as string[], plan: buildPlan(req.target, normalized.rows, existing, brandNames, normalized.errors) };
}

export async function previewImport(req: ImportRequest): Promise<PreviewResult> {
  { const g = await adminOnlyError(); if (g) return g as never; }
  const r = await plan(req);
  if (!r.plan) return { ok: false, problems: r.problems };
  const p = r.plan;
  return {
    ok: true,
    summary: p.summary,
    priceChanges: p.priceChanges.slice(0, 100),
    errors: p.errors.slice(0, 100),
    newBrands: p.brandsToCreate.map((b) => b.name),
    newSamples: p.creates.slice(0, 10).map((c) => [c.brand, c.reference, c.name].filter(Boolean).join(" ")),
  };
}

export async function commitImport(req: ImportRequest): Promise<{ ok: boolean; message: string }> {
  { const g = await adminOnlyError(); if (g) return g as never; }
  const r = await plan(req);
  if (!r.plan) return { ok: false, message: r.problems.join(". ") };
  const p = r.plan;
  if (p.creates.length + p.updates.length === 0) return { ok: true, message: "Rien à mettre à jour : votre catalogue est déjà à jour." };
  const { error } = await r.supabase.rpc("apply_catalog_import", {
    p_target: req.target,
    p_supplier_name: req.supplierName.trim(),
    p_mapping: req.mapping,
    p_filename: req.filename,
    p_brands: p.brandsToCreate,
    p_creates: p.creates,
    p_updates: p.updates,
  });
  if (error) return { ok: false, message: "L'import a échoué, rien n'a été modifié. Réessayez." };
  revalidatePath("/app/catalogue");
  return { ok: true, message: `Import terminé : ${p.summary.newItems} ajout(s), ${p.updates.length} mise(s) à jour.` };
}
