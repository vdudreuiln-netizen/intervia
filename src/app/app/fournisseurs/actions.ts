"use server";

import { revalidatePath } from "next/cache";
import { adminOnlyError } from "@/lib/billing/guard";
import { getCurrentCompany } from "@/lib/company/current";
import { familyRows, parseDiscountEntries, parseSupplierForm, type DiscountEntryForm, type SupplierErrors, type SupplierForm } from "@/lib/suppliers/forms";
import { refreshReferencePrices } from "@/lib/suppliers/load";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FAIL = "Enregistrement impossible. Réessayez.";

type Result = {
  ok: boolean;
  message?: string;
  id?: string;
  errors?: Record<string, string>;
};

/** Administrateur : écritures du catalogue (la base l'impose aussi). */
async function ctx() {
  const g = await adminOnlyError();
  if (g) return { error: g };
  const c = await getCurrentCompany();
  return { supabase: c.supabase, companyId: c.company.id };
}

function done(id?: string) {
  revalidatePath("/app/fournisseurs");
  if (id) revalidatePath(`/app/fournisseurs/${id}`);
  revalidatePath("/app/catalogue");
}

async function refresh(supabase: Awaited<ReturnType<typeof getCurrentCompany>>["supabase"], companyId: string): Promise<string | undefined> {
  try {
    await refreshReferencePrices(supabase, companyId);
    return undefined;
  } catch {
    return " (recalcul des prix de référence à relancer)";
  }
}

export async function saveSupplier(id: string | null, form: SupplierForm): Promise<Result & { errors?: SupplierErrors }> {
  const c = await ctx();
  if ("error" in c) return c.error!;
  const parsed = parseSupplierForm(form);
  if (!parsed.ok)
    return {
      ok: false,
      errors: parsed.errors as Record<string, string>,
      message: "Certains champs sont à corriger.",
    };
  const row = { ...parsed.values, company_id: c.companyId };
  const q = id && UUID.test(id) ? c.supabase.from("suppliers").update(row).eq("company_id", c.companyId).eq("id", id).select("id").single() : c.supabase.from("suppliers").insert(row).select("id").single();
  const { data, error } = await q;
  if (error)
    return {
      ok: false,
      message: error.code === "23505" ? "Un fournisseur porte déjà ce nom." : FAIL,
    };
  done(data.id);
  return { ok: true, id: data.id, message: "Fournisseur enregistré ✔" };
}

/** Désactiver : ses tarifs ne sont plus utilisés dans les devis (ils restent enregistrés). */
export async function setSupplierActive(id: string, active: boolean): Promise<Result> {
  const c = await ctx();
  if ("error" in c) return c.error!;
  if (!UUID.test(id)) return { ok: false, message: "Fournisseur introuvable." };
  const { error } = await c.supabase.from("suppliers").update({ active }).eq("company_id", c.companyId).eq("id", id);
  if (error) return { ok: false, message: FAIL };
  const warn = await refresh(c.supabase, c.companyId);
  done(id);
  return {
    ok: true,
    message: (active ? "Fournisseur réactivé ✔" : "Fournisseur désactivé : ses tarifs ne sont plus utilisés ✔") + (warn ?? ""),
  };
}

export async function deleteSupplier(id: string): Promise<Result> {
  const c = await ctx();
  if ("error" in c) return c.error!;
  if (!UUID.test(id)) return { ok: false, message: "Fournisseur introuvable." };
  const { error } = await c.supabase.from("suppliers").delete().eq("company_id", c.companyId).eq("id", id);
  if (error) return { ok: false, message: "Suppression impossible. Réessayez." };
  await refresh(c.supabase, c.companyId);
  done();
  return { ok: true, message: "Fournisseur supprimé ✔" };
}

/** Remises par marque chez un fournisseur (vide = retirer). */
export async function saveBrandDiscounts(supplierId: string, entries: DiscountEntryForm[]): Promise<Result> {
  const c = await ctx();
  if ("error" in c) return c.error!;
  if (!UUID.test(supplierId)) return { ok: false, message: "Fournisseur introuvable." };
  const parsed = parseDiscountEntries(entries);
  if (!parsed.ok)
    return {
      ok: false,
      errors: parsed.errors,
      message: "Certaines remises sont à corriger.",
    };
  const set = parsed.changes.filter((ch) => ch.rate !== null && UUID.test(ch.key));
  const unset = parsed.changes.filter((ch) => ch.rate === null && UUID.test(ch.key)).map((ch) => ch.key);
  if (set.length) {
    const { error } = await c.supabase.from("supplier_discounts").upsert(
      set.map((ch) => ({
        company_id: c.companyId,
        supplier_id: supplierId,
        brand_id: ch.key,
        rate: ch.rate,
        updated_at: new Date().toISOString(),
      })),
      { onConflict: "supplier_id,brand_id" },
    );
    if (error) return { ok: false, message: FAIL };
  }
  if (unset.length) await c.supabase.from("supplier_discounts").delete().eq("company_id", c.companyId).eq("supplier_id", supplierId).in("brand_id", unset);
  const warn = await refresh(c.supabase, c.companyId);
  done(supplierId);
  return {
    ok: true,
    message: "Remises par marque enregistrées ✔" + (warn ?? ""),
  };
}

/** Remises par famille de remise (ou gamme) chez un fournisseur. */
export async function saveFamilyDiscounts(supplierId: string, entries: DiscountEntryForm[]): Promise<Result> {
  const c = await ctx();
  if ("error" in c) return c.error!;
  if (!UUID.test(supplierId)) return { ok: false, message: "Fournisseur introuvable." };
  const parsed = parseDiscountEntries(entries);
  if (!parsed.ok)
    return {
      ok: false,
      errors: parsed.errors,
      message: "Certaines remises sont à corriger.",
    };
  const rows = familyRows(parsed.changes);
  const set = rows.filter((r) => r.rate !== null);
  const unset = rows.filter((r) => r.rate === null).map((r) => r.family_key);
  if (set.length) {
    const { error } = await c.supabase.from("supplier_discounts").upsert(
      set.map((r) => ({
        company_id: c.companyId,
        supplier_id: supplierId,
        family: r.family,
        family_key: r.family_key,
        rate: r.rate,
        updated_at: new Date().toISOString(),
      })),
      { onConflict: "supplier_id,family_key" },
    );
    if (error) return { ok: false, message: FAIL };
  }
  if (unset.length) await c.supabase.from("supplier_discounts").delete().eq("company_id", c.companyId).eq("supplier_id", supplierId).in("family_key", unset);
  const warn = await refresh(c.supabase, c.companyId);
  done(supplierId);
  return {
    ok: true,
    message: "Remises par famille enregistrées ✔" + (warn ?? ""),
  };
}

/** Fournisseur de référence d'une marque : son prix public devient le prix de référence (prix client). */
export async function setReferenceSupplier(brandId: string, supplierId: string | null): Promise<Result> {
  const c = await ctx();
  if ("error" in c) return c.error!;
  if (!UUID.test(brandId) || (supplierId !== null && !UUID.test(supplierId))) return { ok: false, message: "Choix invalide." };
  const { error } = await c.supabase.from("brands").update({ reference_supplier_id: supplierId }).eq("company_id", c.companyId).eq("id", brandId);
  if (error) return { ok: false, message: FAIL };
  const warn = await refresh(c.supabase, c.companyId);
  done();
  return {
    ok: true,
    message: "Fournisseur de référence enregistré : prix de vente recalculés ✔" + (warn ?? ""),
  };
}

/** Correspondance probable confirmée : le tarif est désormais utilisé dans les prix. */
export async function confirmMatch(offerId: string): Promise<Result> {
  const c = await ctx();
  if ("error" in c) return c.error!;
  if (!UUID.test(offerId)) return { ok: false, message: "Correspondance introuvable." };
  const { error } = await c.supabase.from("supplier_offers").update({ match_status: "manuel", match_reason: "Confirmée à la main" }).eq("company_id", c.companyId).eq("id", offerId).eq("match_status", "probable");
  if (error) return { ok: false, message: FAIL };
  const warn = await refresh(c.supabase, c.companyId);
  done();
  return { ok: true, message: "Correspondance confirmée ✔" + (warn ?? "") };
}

/**
 * Correspondance refusée : le tarif devient un article DISTINCT du catalogue
 * (caractéristiques reprises de l'article proche, à vérifier), pour qu'un
 * prochain import ne repropose pas le même rapprochement.
 */
export async function rejectMatch(offerId: string): Promise<Result> {
  const c = await ctx();
  if ("error" in c) return c.error!;
  if (!UUID.test(offerId)) return { ok: false, message: "Correspondance introuvable." };
  const { data: o } = await c.supabase
    .from("supplier_offers")
    .select("id, product_id, accessory_id, manufacturer_ref, designation, public_price_cents, net_price_cents")
    .eq("company_id", c.companyId)
    .eq("id", offerId)
    .eq("match_status", "probable")
    .maybeSingle();
  if (!o || !o.manufacturer_ref) return { ok: false, message: "Correspondance introuvable." };
  let newId: string | null = null;
  if (o.product_id) {
    const { data: p } = await c.supabase
      .from("products")
      .select("brand_id, range_name, type, cooling_kw, heating_kw, max_outlets, max_indoor_ratio, link_diameters, precharged_length_m, extra_charge_g_per_m")
      .eq("company_id", c.companyId)
      .eq("id", o.product_id)
      .single();
    if (!p) return { ok: false, message: FAIL };
    const { data, error } = await c.supabase
      .from("products")
      .insert({
        ...p,
        company_id: c.companyId,
        reference: o.manufacturer_ref,
        public_price_cents: o.public_price_cents ?? o.net_price_cents ?? 0,
      })
      .select("id")
      .single();
    if (error)
      return {
        ok: false,
        message: error.code === "23505" ? "Un article porte déjà cette référence : rattachez le tarif à la main." : FAIL,
      };
    newId = data.id;
  } else if (o.accessory_id) {
    const { data: a } = await c.supabase.from("accessories").select("category, name, diameter, unit").eq("company_id", c.companyId).eq("id", o.accessory_id).single();
    if (!a) return { ok: false, message: FAIL };
    const { data, error } = await c.supabase
      .from("accessories")
      .insert({
        ...a,
        name: o.designation ?? a.name,
        company_id: c.companyId,
        reference: o.manufacturer_ref,
        public_price_cents: o.public_price_cents,
        purchase_price_cents: o.net_price_cents,
        discount_rate: 0,
      })
      .select("id")
      .single();
    if (error)
      return {
        ok: false,
        message: error.code === "23505" ? "Un accessoire porte déjà cette référence : rattachez le tarif à la main." : FAIL,
      };
    newId = data.id;
  }
  const { error } = await c.supabase
    .from("supplier_offers")
    .update({
      ...(o.product_id ? { product_id: newId } : { accessory_id: newId }),
      match_status: "manuel",
      match_reason: "Article distinct (correspondance refusée)",
    })
    .eq("company_id", c.companyId)
    .eq("id", offerId);
  if (error) return { ok: false, message: FAIL };
  const warn = await refresh(c.supabase, c.companyId);
  done();
  return {
    ok: true,
    message: `« ${o.manufacturer_ref} » ajouté comme article distinct (caractéristiques reprises de l'article proche : à vérifier dans le catalogue) ✔` + (warn ?? ""),
  };
}

/** Rapprochement manuel : rattacher le tarif d'un fournisseur à un autre article du catalogue. */
export async function linkOffer(offerId: string, target: { productId?: string; accessoryId?: string }): Promise<Result> {
  const c = await ctx();
  if ("error" in c) return c.error!;
  const productId = target.productId && UUID.test(target.productId) ? target.productId : null;
  const accessoryId = target.accessoryId && UUID.test(target.accessoryId) ? target.accessoryId : null;
  if (!UUID.test(offerId) || (productId === null) === (accessoryId === null)) return { ok: false, message: "Choix invalide." };
  const { error } = await c.supabase
    .from("supplier_offers")
    .update({
      product_id: productId,
      accessory_id: accessoryId,
      match_status: "manuel",
      match_reason: "Rapproché à la main",
    })
    .eq("company_id", c.companyId)
    .eq("id", offerId);
  if (error)
    return {
      ok: false,
      message: error.code === "23505" ? "Ce fournisseur a déjà un tarif pour cet article." : FAIL,
    };
  const warn = await refresh(c.supabase, c.companyId);
  done();
  return { ok: true, message: "Tarif rattaché ✔" + (warn ?? "") };
}
