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
  /** Tarif d'un distributeur (achat) ou d'un fabricant (prix publics d'une marque). */
  origin: "distributeur" | "fabricant";
  /** Fabricant : marque du tarif (la correspondance des colonnes est mémorisée par marque). */
  brandName: string;
  /** Fournisseur existant, ou null + supplierName pour en créer un. */
  supplierId: string | null;
  supplierName: string;
  /** Date d'effet du tarif (AAAA-MM-JJ). */
  tariffDate: string;
  /** Case « prix publics » / « prix nets » du fichier. */
  priceKind: "public" | "net";
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
  /** Toutes les lignes en erreur (rapport téléchargeable). */
  allErrors?: ImportPlan["errors"];
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const fabricantName = (brand: string) => `Tarif fabricant ${brand.trim()}`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function resolveSupplier(supabase: SupabaseClient, companyId: string, req: ImportRequest): Promise<{ id: string | null; name: string } | null> {
  if (req.origin === "fabricant") {
    const brand = req.brandName.trim();
    if (!brand) return null;
    const { data: b } = await supabase.from("brands").select("id").eq("company_id", companyId).ilike("name", brand).maybeSingle();
    if (b) {
      const { data } = await supabase.from("suppliers").select("id, name").eq("company_id", companyId).eq("kind", "fabricant").eq("brand_id", b.id).maybeSingle();
      if (data) return { id: data.id, name: data.name };
    }
    return { id: null, name: fabricantName(brand) };
  }
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
  if (req.origin === "fabricant") {
    req = { ...req, priceKind: "public", defaults: { ...req.defaults, brand: req.target === "materiel" ? req.brandName.trim() || req.defaults.brand : req.defaults.brand } };
    if (req.target === "materiel") req.mapping = { ...req.mapping, brand: undefined };
  }
  req = { ...req, defaults: { ...req.defaults, priceKind: req.priceKind === "net" ? "net" : "public" } };
  const problems = validateMapping(req.mapping, req.target, req.defaults);
  const supplier = await resolveSupplier(supabase, company.id, req);
  if (!supplier) problems.push(req.origin === "fabricant" ? "Indiquez la marque du tarif fabricant" : "Indiquez le fournisseur");
  if (!ISO_DATE.test(req.tariffDate) || Number.isNaN(new Date(req.tariffDate).getTime())) problems.push("Indiquez la date du tarif");
  else if (req.tariffDate > new Date(Date.now() + 366 * 864e5).toISOString().slice(0, 10)) problems.push("Date du tarif trop lointaine");
  if (req.rows.length === 0) problems.push("Aucune ligne de données trouvée dans le fichier");
  if (req.rows.length > MAX_IMPORT_ROWS) problems.push(`Fichier trop gros : ${MAX_IMPORT_ROWS} lignes maximum`);
  if (problems.length || !supplier) return { supabase, companyId: company.id, supplier, problems, plan: null, req };

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
    req,
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
    allErrors: p.errors,
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
  if (!supplierId && r.req.origin === "fabricant") {
    // Tarif fabricant : une « source de prix » par marque (pas un fournisseur chez qui acheter)
    const brand = r.req.brandName.trim();
    let { data: b } = await r.supabase.from("brands").select("id").eq("company_id", r.companyId).ilike("name", brand).maybeSingle();
    if (!b) ({ data: b } = await r.supabase.from("brands").insert({ company_id: r.companyId, name: brand, discount_rate: 0 }).select("id").single());
    if (!b) return { ok: false, message: "Création de la marque impossible. Réessayez." };
    const { data, error } = await r.supabase.from("suppliers").insert({ company_id: r.companyId, name: r.supplier.name, kind: "fabricant", brand_id: b.id }).select("id").single();
    if (error) return { ok: false, message: "Création du tarif fabricant impossible. Réessayez." };
    supplierId = data.id as string;
  }
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
    p_tariff_date: r.req.tariffDate,
    p_price_kind: r.req.defaults.priceKind ?? "public",
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
  if (p.summary.errors) parts.push(`${p.summary.errors} ligne(s) en erreur ignorée(s)`);
  if (p.summary.probable) parts.push(`${p.summary.probable} correspondance(s) probable(s) à confirmer dans Fournisseurs`);
  return { ok: true, message: `Import terminé : ${parts.join(", ")}.` };
}

/** Dernier import encore annulable (affiché sur la page d'import). */
export interface LastImport {
  filename: string | null;
  createdAt: string;
  supplier: string | null;
  tariffDate: string | null;
  priceKind: "public" | "net";
  created: number;
  updated: number;
}

/** « Annuler le dernier import » : prix, tarifs et articles créés reviennent à l'état d'avant. */
export async function undoLastImport(): Promise<{ ok: boolean; message: string }> {
  { const g = await adminOnlyError(); if (g) return g as never; }
  const { supabase, company } = await getCurrentCompany();
  const { data, error } = await supabase.rpc("undo_last_catalog_import");
  if (error) return { ok: false, message: /Aucun import/.test(error.message) ? "Aucun import à annuler." : /avant cette fonctionnalité/.test(error.message) ? "Ce dernier import date d'avant cette fonctionnalité : il ne peut pas être annulé automatiquement." : "Annulation impossible, rien n'a été modifié. Réessayez." };
  try {
    await refreshReferencePrices(supabase, company.id);
  } catch {
    // les prix de référence seront recalculés au prochain import ou à la prochaine modification
  }
  revalidatePath("/app/catalogue");
  revalidatePath("/app/catalogue/import");
  revalidatePath("/app/fournisseurs");
  const d = data as { filename: string | null; restored: number; deleted: number; disabled: number };
  const parts = [`${d.restored} tarif(s) remis à l'état précédent`, `${d.deleted} élément(s) créé(s) supprimé(s)`];
  if (d.disabled) parts.push(`${d.disabled} article(s) déjà utilisé(s) dans un devis désactivé(s) au lieu d'être supprimé(s)`);
  return { ok: true, message: `Import « ${d.filename ?? "sans nom"} » annulé : ${parts.join(", ")}. Les devis déjà émis gardent leurs prix.` };
}
