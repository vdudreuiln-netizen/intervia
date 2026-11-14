import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { catalogPrices, type CatalogPrices } from "@/lib/pricing/engine";
import type { ProductType } from "./import";

export interface BrandItem {
  id: string;
  name: string;
  discount_rate: number;
  sale_coefficient: number;
  is_example: boolean;
  product_count: number;
}

export interface ProductItem {
  id: string;
  brand_id: string;
  brand_name: string;
  range_name: string | null;
  reference: string;
  type: ProductType;
  cooling_kw: number | null;
  heating_kw: number | null;
  max_outlets: number | null;
  max_indoor_ratio: number | null;
  public_price_cents: number;
  discount_rate: number | null;
  is_example: boolean;
  prices: CatalogPrices;
}

export interface AccessoryItem {
  id: string;
  reference: string | null;
  category: string;
  name: string;
  diameter: string | null;
  unit: string;
  public_price_cents: number | null;
  purchase_price_cents: number | null;
  discount_rate: number;
  is_example: boolean;
  prices: CatalogPrices;
}

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/** Lit toutes les lignes d'une requête (Supabase plafonne à 1 000 lignes par appel). */
export async function fetchAll<T>(query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await query(from, from + page - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < page) return out;
  }
}

export async function loadBrands(supabase: SupabaseClient): Promise<BrandItem[]> {
  const { data, error } = await supabase.from("brands").select("id, name, discount_rate, sale_coefficient, is_example, products(count)").order("name");
  if (error) throw new Error(error.message);
  return (data ?? []).map((b) => ({
    id: b.id,
    name: b.name,
    discount_rate: Number(b.discount_rate),
    sale_coefficient: Number(b.sale_coefficient),
    is_example: b.is_example,
    product_count: (b.products as unknown as { count: number }[])[0]?.count ?? 0,
  }));
}

type RawProduct = Record<string, unknown> & { brands: { name: string; discount_rate: number; sale_coefficient: number } };

export async function loadProducts(supabase: SupabaseClient): Promise<ProductItem[]> {
  const rows = await fetchAll<RawProduct>((from, to) =>
    supabase
      .from("products")
      .select("id, brand_id, range_name, reference, type, cooling_kw, heating_kw, max_outlets, max_indoor_ratio, public_price_cents, discount_rate, is_example, brands(name, discount_rate, sale_coefficient)")
      .eq("active", true)
      .order("type")
      .order("cooling_kw")
      .range(from, to) as unknown as PromiseLike<{ data: RawProduct[] | null; error: { message: string } | null }>,
  );
  return rows.map((p) => {
    const item = {
      id: p.id as string,
      brand_id: p.brand_id as string,
      brand_name: p.brands.name,
      range_name: (p.range_name as string | null) ?? null,
      reference: p.reference as string,
      type: p.type as ProductType,
      cooling_kw: num(p.cooling_kw),
      heating_kw: num(p.heating_kw),
      max_outlets: num(p.max_outlets),
      max_indoor_ratio: num(p.max_indoor_ratio),
      public_price_cents: Number(p.public_price_cents),
      discount_rate: num(p.discount_rate),
      is_example: p.is_example as boolean,
    };
    return {
      ...item,
      prices: catalogPrices({
        kind: "material",
        publicPriceCents: item.public_price_cents,
        brandDiscount: Number(p.brands.discount_rate),
        productDiscount: item.discount_rate,
        brandCoefficient: Number(p.brands.sale_coefficient),
      }),
    };
  });
}

export async function loadAccessories(supabase: SupabaseClient, companyCoefficient: number, purchaseCoefficient: number): Promise<AccessoryItem[]> {
  const rows = await fetchAll<Record<string, unknown>>((from, to) =>
    supabase
      .from("accessories")
      .select("id, reference, category, name, diameter, unit, public_price_cents, purchase_price_cents, discount_rate, is_example")
      .eq("active", true)
      .order("category")
      .order("name")
      .range(from, to) as unknown as PromiseLike<{ data: Record<string, unknown>[] | null; error: { message: string } | null }>,
  );
  return rows.map((a) => {
    const public_price_cents = num(a.public_price_cents);
    const purchase_price_cents = num(a.purchase_price_cents);
    const discount_rate = Number(a.discount_rate);
    return {
      id: a.id as string,
      reference: (a.reference as string | null) ?? null,
      category: a.category as string,
      name: a.name as string,
      diameter: (a.diameter as string | null) ?? null,
      unit: a.unit as string,
      public_price_cents,
      purchase_price_cents,
      discount_rate,
      is_example: a.is_example as boolean,
      prices: catalogPrices({ kind: "accessory", publicPriceCents: public_price_cents, purchasePriceCents: purchase_price_cents, discount: discount_rate, companyCoefficient, purchaseCoefficient }),
    };
  });
}

export interface PriceHistoryItem {
  changed_at: string;
  old_public_price_cents: number | null;
  new_public_price_cents: number;
  old_discount_rate: number | null;
  new_discount_rate: number | null;
  from_import: boolean;
}

export async function loadPriceHistory(supabase: SupabaseClient, column: "product_id" | "accessory_id", id: string): Promise<PriceHistoryItem[]> {
  const { data } = await supabase
    .from("price_history")
    .select("changed_at, old_public_price_cents, new_public_price_cents, old_discount_rate, new_discount_rate, import_id")
    .eq(column, id)
    .order("changed_at", { ascending: false })
    .limit(20);
  return (data ?? []).map((h) => ({
    changed_at: h.changed_at,
    old_public_price_cents: num(h.old_public_price_cents),
    new_public_price_cents: Number(h.new_public_price_cents),
    old_discount_rate: num(h.old_discount_rate),
    new_discount_rate: num(h.new_discount_rate),
    from_import: h.import_id !== null,
  }));
}
