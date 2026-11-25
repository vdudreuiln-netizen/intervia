"use server";

import { adminOnlyError } from "@/lib/billing/guard";

import { revalidatePath } from "next/cache";
import { getCurrentCompany } from "@/lib/company/current";
import { parseAccessoryForm, parseBrandForm, parseProductForm, type AccessoryForm, type BrandForm, type ProductForm } from "@/lib/catalog/forms";
import { refreshReferencePrices } from "@/lib/suppliers/load";

export interface ActionResult<E = Record<string, string | undefined>> {
  ok: boolean;
  errors?: E;
  message?: string;
  id?: string;
}

const UUID = /^[0-9a-f-]{36}$/i;

function friendly(error: { code?: string; message: string }): string {
  if (error.code === "23505") return "Cette référence existe déjà pour cette marque.";
  if (error.code === "23503") return "Élément utilisé ailleurs : suppression impossible.";
  return "Enregistrement impossible. Réessayez.";
}

/**
 * Produit : caractéristiques + tarif chez UN fournisseur (prix public, remise
 * propre ou vide = remise de famille / marque de ce fournisseur). Le prix public
 * de référence (prix client) est ensuite recalculé sur tous les fournisseurs.
 */
export async function saveProduct(id: string | null, form: ProductForm, supplierId: string | null): Promise<ActionResult> {
  {
    const g = await adminOnlyError();
    if (g) return g as never;
  }
  const { supabase, company } = await getCurrentCompany();
  const parsed = parseProductForm(form);
  if (!parsed.ok)
    return {
      ok: false,
      errors: parsed.errors,
      message: "Certains champs sont à corriger.",
    };
  if (!supplierId || !UUID.test(supplierId)) return { ok: false, message: "Choisissez le fournisseur de ce tarif." };
  const { data: sup } = await supabase.from("suppliers").select("id").eq("company_id", company.id).eq("id", supplierId).maybeSingle();
  if (!sup) return { ok: false, message: "Fournisseur introuvable." };
  const { public_price_cents, discount_rate, ...tech } = parsed.values;
  const isUpdate = Boolean(id && UUID.test(id));
  // Le prix public de l'article = prix de référence recalculé ; à la création, celui saisi.
  const row = isUpdate
    ? { ...tech, company_id: company.id }
    : {
        ...tech,
        public_price_cents,
        company_id: company.id,
        supplier_id: supplierId,
      };
  const q = isUpdate ? supabase.from("products").update(row).eq("company_id", company.id).eq("id", id!).select("id").single() : supabase.from("products").insert(row).select("id").single();
  const { data, error } = await q;
  if (error) return { ok: false, message: friendly(error) };
  const offer = await supabase.from("supplier_offers").upsert(
    {
      company_id: company.id,
      supplier_id: supplierId,
      product_id: data.id,
      manufacturer_ref: tech.reference,
      public_price_cents,
      net_price_cents: null,
      discount_rate,
      match_status: "manuel",
      match_reason: "Saisi à la main",
      price_origin: "manuel",
      tariff_date: new Date().toISOString().slice(0, 10),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "supplier_id,product_id" },
  );
  if (offer.error)
    return {
      ok: false,
      message: "Produit enregistré, mais pas son tarif fournisseur. Réessayez.",
    };
  try {
    await refreshReferencePrices(supabase, company.id);
  } catch {
    /* recalculé au prochain import ou à la prochaine modification */
  }
  revalidatePath("/app/catalogue");
  return { ok: true, id: data.id, message: "Produit enregistré ✔" };
}

export async function deleteProduct(id: string): Promise<ActionResult> {
  { const g = await adminOnlyError(); if (g) return g as never; }
  const { supabase } = await getCurrentCompany();
  const { error } = await supabase.from("products").delete().eq("id", id);
  if (error) return { ok: false, message: friendly(error) };
  revalidatePath("/app/catalogue");
  return { ok: true };
}

/** Accessoire : caractéristiques + tarif chez UN fournisseur (voir saveProduct). */
export async function saveAccessory(id: string | null, form: AccessoryForm, supplierId: string | null): Promise<ActionResult> {
  {
    const g = await adminOnlyError();
    if (g) return g as never;
  }
  const { supabase, company } = await getCurrentCompany();
  const parsed = parseAccessoryForm(form);
  if (!parsed.ok)
    return {
      ok: false,
      errors: parsed.errors,
      message: "Certains champs sont à corriger.",
    };
  if (!supplierId || !UUID.test(supplierId)) return { ok: false, message: "Choisissez le fournisseur de ce tarif." };
  const { data: sup } = await supabase.from("suppliers").select("id").eq("company_id", company.id).eq("id", supplierId).maybeSingle();
  if (!sup) return { ok: false, message: "Fournisseur introuvable." };
  const v = parsed.values;
  const isUpdate = Boolean(id && UUID.test(id));
  const { discount_rate: _d, ...item } = v;
  const row = isUpdate
    ? { ...item, company_id: company.id }
    : {
        ...item,
        discount_rate: 0,
        company_id: company.id,
        supplier_id: supplierId,
      };
  const q = isUpdate ? supabase.from("accessories").update(row).eq("company_id", company.id).eq("id", id!).select("id").single() : supabase.from("accessories").insert(row).select("id").single();
  const { data, error } = await q;
  if (error)
    return {
      ok: false,
      message: error.code === "23505" ? "Cette référence existe déjà." : friendly(error),
    };
  // Remise vide (0 saisi par défaut dans le formulaire) = remise de famille du fournisseur
  const ownDiscount = form.discount.trim() === "" ? null : v.discount_rate;
  const offer = await supabase.from("supplier_offers").upsert(
    {
      company_id: company.id,
      supplier_id: supplierId,
      accessory_id: data.id,
      manufacturer_ref: v.reference,
      designation: v.name,
      public_price_cents: v.public_price_cents,
      net_price_cents: v.public_price_cents === null ? v.purchase_price_cents : null,
      discount_rate: v.public_price_cents === null ? null : ownDiscount,
      match_status: "manuel",
      match_reason: "Saisi à la main",
      price_origin: "manuel",
      tariff_date: new Date().toISOString().slice(0, 10),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "supplier_id,accessory_id" },
  );
  if (offer.error)
    return {
      ok: false,
      message: "Accessoire enregistré, mais pas son tarif fournisseur. Réessayez.",
    };
  try {
    await refreshReferencePrices(supabase, company.id);
  } catch {
    /* recalculé au prochain import ou à la prochaine modification */
  }
  revalidatePath("/app/catalogue");
  return { ok: true, id: data.id, message: "Accessoire enregistré ✔" };
}

export async function deleteAccessory(id: string): Promise<ActionResult> {
  { const g = await adminOnlyError(); if (g) return g as never; }
  const { supabase } = await getCurrentCompany();
  const { error } = await supabase.from("accessories").delete().eq("id", id);
  if (error) return { ok: false, message: friendly(error) };
  revalidatePath("/app/catalogue");
  return { ok: true };
}

export async function saveBrand(id: string | null, form: BrandForm): Promise<ActionResult> {
  { const g = await adminOnlyError(); if (g) return g as never; }
  const { supabase, company } = await getCurrentCompany();
  const parsed = parseBrandForm(form);
  if (!parsed.ok) return { ok: false, errors: parsed.errors, message: "Certains champs sont à corriger." };
  const row = { ...parsed.values, company_id: company.id };
  const q = id && UUID.test(id) ? supabase.from("brands").update(row).eq("id", id).select("id").single() : supabase.from("brands").insert(row).select("id").single();
  const { data, error } = await q;
  if (error) return { ok: false, message: error.code === "23505" ? "Cette marque existe déjà." : friendly(error) };
  revalidatePath("/app/catalogue");
  return { ok: true, id: data.id, message: "Marque enregistrée ✔" };
}

/** Supprime une marque ET ses produits (confirmé côté écran). */
export async function deleteBrand(id: string): Promise<ActionResult> {
  { const g = await adminOnlyError(); if (g) return g as never; }
  const { supabase } = await getCurrentCompany();
  const { error } = await supabase.from("brands").delete().eq("id", id);
  if (error) return { ok: false, message: friendly(error) };
  revalidatePath("/app/catalogue");
  return { ok: true };
}

/** Retire le catalogue d'exemple (marques fictives, leurs produits, accessoires exemple). */
export async function deleteExamples(): Promise<ActionResult> {
  { const g = await adminOnlyError(); if (g) return g as never; }
  const { supabase } = await getCurrentCompany();
  const a = await supabase.from("brands").delete().eq("is_example", true);
  const b = await supabase.from("accessories").delete().eq("is_example", true);
  if (a.error || b.error) return { ok: false, message: "Suppression impossible. Réessayez." };
  revalidatePath("/app/catalogue");
  return { ok: true, message: "Catalogue d'exemple supprimé ✔" };
}

/** Fiche technique fabricant (PDF déjà déposé dans le stockage par le navigateur), ou null pour la retirer. */
export async function setDatasheet(productId: string, file: { path: string; name: string } | null): Promise<ActionResult> {
  { const g = await adminOnlyError(); if (g) return g as never; }
  const { supabase, company } = await getCurrentCompany();
  if (!UUID.test(productId)) return { ok: false, message: "Produit introuvable." };
  const { data: p } = await supabase.from("products").select("datasheet_path").eq("company_id", company.id).eq("id", productId).maybeSingle();
  if (!p) return { ok: false, message: "Produit introuvable." };
  if (file && (!file.path.startsWith(`${company.id}/`) || file.path.includes("..") || !file.path.endsWith(".pdf"))) return { ok: false, message: "Fichier invalide." };
  const { error } = await supabase
    .from("products")
    .update({ datasheet_path: file?.path ?? null, datasheet_name: file ? file.name.slice(0, 120) : null })
    .eq("company_id", company.id)
    .eq("id", productId);
  if (error) return { ok: false, message: "Enregistrement impossible. Réessayez." };
  if (p.datasheet_path && p.datasheet_path !== file?.path) await supabase.storage.from("datasheets").remove([p.datasheet_path]);
  revalidatePath(`/app/catalogue/materiel/${productId}`);
  return { ok: true, message: file ? "Fiche technique enregistrée ✔ (jointe aux devis qui contiennent ce produit)" : "Fiche technique retirée ✔" };
}

export interface ProductTechForm {
  refrigerant: string;
  factoryChargeKg: string;
  maxLinkM: string;
  maxHeightDiffM: string;
  clearances: Record<"top" | "left" | "right" | "bottom" | "front" | "rear", string>;
}

/** Données de pose de la notice (règles d'implantation, fiche fluides). */
export async function saveProductTech(productId: string, f: ProductTechForm): Promise<ActionResult> {
  { const g = await adminOnlyError(); if (g) return g as never; }
  const { supabase, company } = await getCurrentCompany();
  if (!UUID.test(productId)) return { ok: false, message: "Produit introuvable." };
  const num = (v: string, min: number, max: number): number | null | "bad" => {
    if (v.trim() === "") return null;
    const n = Number(v.replace(",", ".").replace(/\s/g, ""));
    return Number.isFinite(n) && n >= min && n <= max ? n : "bad";
  };
  const charge = num(f.factoryChargeKg, 0.05, 99);
  const link = num(f.maxLinkM, 1, 300);
  const diff = num(f.maxHeightDiffM, 0, 100);
  if (charge === "bad" || link === "bad" || diff === "bad") return { ok: false, message: "Valeur illisible (charge en kg, longueurs en m)." };
  const clearances: Record<string, number> = {};
  for (const [k, v] of Object.entries(f.clearances)) {
    const n = num(v, 0, 500);
    if (n === "bad") return { ok: false, message: "Dégagement illisible (en cm)." };
    if (n !== null && n > 0) clearances[k] = Math.round(n);
  }
  const refrigerant = ["R32", "R410A", "R290", "R454B", "autre"].includes(f.refrigerant) ? f.refrigerant : null;
  const { error } = await supabase.from("products").update({ refrigerant, factory_charge_kg: charge, max_link_m: link, max_height_diff_m: diff, clearances }).eq("company_id", company.id).eq("id", productId);
  if (error) return { ok: false, message: "Enregistrement impossible. Réessayez." };
  revalidatePath(`/app/catalogue/materiel/${productId}`);
  return { ok: true, message: "Données de pose enregistrées ✔" };
}
