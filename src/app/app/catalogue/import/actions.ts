"use server";

import { adminOnlyError } from "@/lib/billing/guard";

import type { SupabaseClient } from "@supabase/supabase-js";
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
  type ExistingOffer,
  type ImportDefaults,
  type ImportPlan,
  type ImportTarget,
  type MappedRow,
  type Mapping,
} from "@/lib/catalog/import";
import { refreshReferencePrices } from "@/lib/suppliers/load";

export interface ImportRequest {
  target: ImportTarget;
  /** Fournisseur existant, ou null + supplierName pour en créer un. */
  supplierId: string | null;
  supplierName: string;
  filename: string;
  fileHash: string | null;
  source: "tableur" | "pdf";
  mapping: Mapping;
  defaults: ImportDefaults;
  rows: { line: number; cells: MappedRow }[];
}

export interface PreviewResult {
  ok: boolean;
  problems?: string[];
  summary?: ImportPlan["summary"];
  priceChanges?: ImportPlan["priceChanges"];
  probable?: ImportPlan["probable"];
  errors?: ImportPlan["errors"];
  newBrands?: string[];
  newSamples?: string[];
  /** Même fichier déjà importé chez ce fournisseur. */
  alreadyImportedAt?: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function resolveSupplier(supabase: SupabaseClient, companyId: string, req: ImportRequest): Promise<{ id: string | null; name: string } | null> {
  if (req.supplierId) {
    if (!UUID.test(req.supplierId)) return null;
    const { data } = await supabase.from("suppliers").select("id, name").eq("company_id", companyId).eq("id", req.supplierId).maybeSingle();
    return data ? { id: data.id, name: data.name } : null;
  }
  const name = req.supplierName.trim();
  if (!name) return null;
  const { data } = await supabase.from("suppliers").select("id, name").eq("company_id", companyId).ilike("name", name).maybeSingle();
  return data ? { id: data.id, name: data.name } : { id: null, name };
}

type RawOffer = {
  product_id: string | null;
  accessory_id: string | null;
  supplier_id: string;
  ean: string | null;
  public_price_cents: number | null;
  net_price_cents: number | null;
  discount_rate: number | null;
  match_status: ExistingOffer["match_status"];
};

async function plan(req: ImportRequest) {
  const { supabase, company } = await getCurrentCompany();
  const problems = validateMapping(req.mapping, req.target, req.defaults);
  const supplier = await resolveSupplier(supabase, company.id, req);
  if (!supplier) problems.push("Indiquez le fournisseur");
  if (req.rows.length === 0) problems.push("Aucune ligne de données trouvée dans le fichier");
  if (req.rows.length > MAX_IMPORT_ROWS) problems.push(`Fichier trop gros : ${MAX_IMPORT_ROWS} lignes maximum`);
  if (problems.length || !supplier) return { supabase, companyId: company.id, supplier, problems, plan: null };

  const col = req.target === "materiel" ? "product_id" : "accessory_id";
  const offers = await fetchAll<RawOffer>(
    (from, to) =>
      supabase.from("supplier_offers").select("product_id, accessory_id, supplier_id, ean, public_price_cents, net_price_cents, discount_rate, match_status").eq("company_id", company.id).not(col, "is", null).order("id").range(from, to) as never,
  );
  const eanOf = new Map<string, string>();
  const mine = new Map<string, ExistingOffer>();
  for (const o of offers) {
    const id = (o.product_id ?? o.accessory_id)!;
    if (o.ean && !eanOf.has(id)) eanOf.set(id, o.ean);
    if (o.supplier_id === supplier.id) {
      mine.set(id, {
        public_price_cents: o.public_price_cents === null ? null : Number(o.public_price_cents),
        net_price_cents: o.net_price_cents === null ? null : Number(o.net_price_cents),
        discount_rate: o.discount_rate === null ? null : Number(o.discount_rate),
        match_status: o.match_status,
      });
    }
  }

  let existing: ExistingItem[];
  let brandNames: string[] = [];
  let normalized;
  if (req.target === "materiel") {
    normalized = normalizeMaterialRows(req.rows, req.defaults);
    const products = await fetchAll<{
      id: string;
      reference: string;
      brands: { name: string };
    }>((from, to) => supabase.from("products").select("id, reference, brands(name)").eq("company_id", company.id).order("id").range(from, to) as never);
    existing = products.map((p) => ({
      id: p.id,
      brand: p.brands.name,
      reference: p.reference,
      ean: eanOf.get(p.id) ?? null,
      label: `${p.brands.name} ${p.reference}`,
      offer: mine.get(p.id) ?? null,
    }));
    const { data } = await supabase.from("brands").select("name").eq("company_id", company.id);
    brandNames = (data ?? []).map((b) => b.name);
  } else {
    normalized = normalizeAccessoryRows(req.rows, req.defaults);
    const acc = await fetchAll<{ id: string; reference: string; name: string }>((from, to) => supabase.from("accessories").select("id, reference, name").eq("company_id", company.id).not("reference", "is", null).order("id").range(from, to) as never);
    existing = acc.map((a) => ({
      id: a.id,
      reference: a.reference,
      ean: eanOf.get(a.id) ?? null,
      label: `${a.reference} – ${a.name}`,
      offer: mine.get(a.id) ?? null,
    }));
  }
  return {
    supabase,
    companyId: company.id,
    supplier,
    problems: [] as string[],
    plan: buildPlan(req.target, normalized.rows, existing, brandNames, normalized.errors),
  };
}

export async function previewImport(req: ImportRequest): Promise<PreviewResult> {
  { const g = await adminOnlyError(); if (g) return g as never; }
  const r = await plan(req);
  if (!r.plan) return { ok: false, problems: r.problems };
  const p = r.plan;
  let alreadyImportedAt: string | null = null;
  if (req.fileHash && r.supplier?.id) {
    const { data } = await r.supabase.from("catalog_imports").select("created_at").eq("company_id", r.companyId).eq("supplier_id", r.supplier.id).eq("file_hash", req.fileHash).order("created_at", { ascending: false }).limit(1).maybeSingle();
    alreadyImportedAt = data?.created_at ?? null;
  }
  return {
    ok: true,
    summary: p.summary,
    priceChanges: p.priceChanges.slice(0, 100),
    probable: p.probable.slice(0, 100),
    errors: p.errors.slice(0, 100),
    newBrands: p.brandsToCreate.map((b) => b.name),
    newSamples: p.creates.slice(0, 10).map((c) => [c.brand, c.reference, c.name].filter(Boolean).join(" ")),
    alreadyImportedAt,
  };
}

export async function commitImport(req: ImportRequest): Promise<{ ok: boolean; message: string }> {
  { const g = await adminOnlyError(); if (g) return g as never; }
  const r = await plan(req);
  if (!r.plan || !r.supplier) return { ok: false, message: r.problems.join(". ") };
  const p = r.plan;
  if (p.creates.length + p.offers.length === 0)
    return {
      ok: true,
      message: "Rien à mettre à jour : votre catalogue est déjà à jour.",
    };

  let supplierId = r.supplier.id;
  if (!supplierId) {
    const { data, error } = await r.supabase.from("suppliers").insert({ company_id: r.companyId, name: r.supplier.name }).select("id").single();
    if (error)
      return {
        ok: false,
        message: "Création du fournisseur impossible. Réessayez.",
      };
    supplierId = data.id as string;
  }
  const { error } = await r.supabase.rpc("apply_supplier_import", {
    p_supplier_id: supplierId,
    p_target: req.target,
    p_mapping: req.source === "pdf" ? {} : req.mapping,
    p_filename: req.filename,
    p_file_hash: req.fileHash && /^[0-9a-f]{64}$/.test(req.fileHash) ? req.fileHash : null,
    p_source: req.source === "pdf" ? "pdf" : "tableur",
    p_brands: p.brandsToCreate,
    p_creates: p.creates,
    p_offers: p.offers,
    p_updates: p.updates,
  });
  if (error)
    return {
      ok: false,
      message: "L'import a échoué, rien n'a été modifié. Réessayez.",
    };
  try {
    await refreshReferencePrices(r.supabase, r.companyId);
  } catch {
    return {
      ok: true,
      message: "Import terminé, mais le recalcul des prix de référence a échoué : ouvrez le catalogue puis réessayez l'import.",
    };
  }
  revalidatePath("/app/catalogue");
  revalidatePath("/app/fournisseurs");
  const parts = [`${p.summary.newItems} article(s) ajouté(s)`, `${p.offers.length - p.summary.probable} tarif(s) mis à jour`];
  if (p.summary.probable) parts.push(`${p.summary.probable} correspondance(s) probable(s) à confirmer dans Fournisseurs`);
  return { ok: true, message: `Import terminé : ${parts.join(", ")}.` };
}
