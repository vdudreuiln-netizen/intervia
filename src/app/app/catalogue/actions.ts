"use server";

import { adminOnlyError } from "@/lib/billing/guard";

import { revalidatePath } from "next/cache";
import { getCurrentCompany } from "@/lib/company/current";
import { parseAccessoryForm, parseBrandForm, parseProductForm, type AccessoryForm, type BrandForm, type ProductForm } from "@/lib/catalog/forms";

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

export async function saveProduct(id: string | null, form: ProductForm): Promise<ActionResult> {
  { const g = await adminOnlyError(); if (g) return g as never; }
  const { supabase, company } = await getCurrentCompany();
  const parsed = parseProductForm(form);
  if (!parsed.ok) return { ok: false, errors: parsed.errors, message: "Certains champs sont à corriger." };
  const row = { ...parsed.values, company_id: company.id };
  const q = id && UUID.test(id) ? supabase.from("products").update(row).eq("id", id).select("id").single() : supabase.from("products").insert(row).select("id").single();
  const { data, error } = await q;
  if (error) return { ok: false, message: friendly(error) };
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

export async function saveAccessory(id: string | null, form: AccessoryForm): Promise<ActionResult> {
  { const g = await adminOnlyError(); if (g) return g as never; }
  const { supabase, company } = await getCurrentCompany();
  const parsed = parseAccessoryForm(form);
  if (!parsed.ok) return { ok: false, errors: parsed.errors, message: "Certains champs sont à corriger." };
  const row = { ...parsed.values, company_id: company.id };
  const q = id && UUID.test(id) ? supabase.from("accessories").update(row).eq("id", id).select("id").single() : supabase.from("accessories").insert(row).select("id").single();
  const { data, error } = await q;
  if (error) return { ok: false, message: error.code === "23505" ? "Cette référence existe déjà." : friendly(error) };
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
