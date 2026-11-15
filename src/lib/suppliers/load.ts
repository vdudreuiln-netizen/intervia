import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAll, type AccessoryItem, type ProductItem } from "@/lib/catalog/queries";
import { familyKey, isTariffStale, rankOffers, referencePublicPrice, type DiscountBook, type NetPrice, type ShippingRule, type ShippingTier, type SupplierInfo, type SupplierOffer } from "./pricing";

/**
 * Lecture des données fournisseurs AVEC prix nets : `db` = client du membre
 * autorisé, ou client service côté serveur — toujours filtré par entreprise.
 */

export interface SupplierRow extends SupplierInfo {
  agency: string | null;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  deliveryTerms: string | null;
  lastPriceUpdateAt: string | null;
  stale: boolean;
  active: boolean;
  columnMapping: Record<string, Record<string, string>>;
}

export interface OfferRow extends SupplierOffer {
  id: string;
  productId: string | null;
  accessoryId: string | null;
  supplierRef: string | null;
  manufacturerRef: string | null;
  ean: string | null;
  designation: string | null;
  matchStatus: "certain" | "probable" | "manuel";
  matchReason: string | null;
  updatedAt: string;
}

export interface SupplierBook {
  suppliers: SupplierRow[];
  book: DiscountBook;
  /** Offres utilisables dans les prix (les correspondances probables sont exclues). */
  offersByProduct: Map<string, OfferRow[]>;
  offersByAccessory: Map<string, OfferRow[]>;
  probable: OfferRow[];
  brandOf: Map<string, string>;
  referenceSupplierOfBrand: Map<string, string | null>;
}

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export function toShippingRule(s: { shipping_fee_cents: unknown; franco_cents: unknown; shipping_tiers: unknown }): ShippingRule {
  const tiers = Array.isArray(s.shipping_tiers)
    ? (s.shipping_tiers as ShippingTier[])
        .filter((t) => Number.isFinite(t?.fromCents) && Number.isFinite(t?.feeCents))
        .map((t) => ({
          fromCents: Number(t.fromCents),
          feeCents: Number(t.feeCents),
        }))
    : [];
  return {
    feeCents: Number(s.shipping_fee_cents ?? 0),
    francoCents: num(s.franco_cents),
    tiers,
  };
}

export async function loadSuppliers(db: SupabaseClient, companyId: string, now = new Date()): Promise<SupplierRow[]> {
  const { data, error } = await db
    .from("suppliers")
    .select("id, name, agency, contact_name, phone, email, delivery_terms, shipping_fee_cents, franco_cents, shipping_tiers, last_price_update_at, active, column_mapping")
    .eq("company_id", companyId)
    .order("name");
  if (error) throw new Error(error.message);
  return (data ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    shipping: toShippingRule(s),
    agency: s.agency,
    contactName: s.contact_name,
    phone: s.phone,
    email: s.email,
    deliveryTerms: s.delivery_terms,
    lastPriceUpdateAt: s.last_price_update_at,
    stale: isTariffStale(s.last_price_update_at, now),
    active: s.active,
    columnMapping: (s.column_mapping ?? {}) as Record<string, Record<string, string>>,
  }));
}

function toOffer(o: Record<string, unknown>): OfferRow {
  return {
    id: o.id as string,
    supplierId: o.supplier_id as string,
    productId: (o.product_id as string | null) ?? null,
    accessoryId: (o.accessory_id as string | null) ?? null,
    publicPriceCents: num(o.public_price_cents),
    netPriceCents: num(o.net_price_cents),
    discount: num(o.discount_rate),
    family: (o.discount_family as string | null) ?? null,
    supplierRef: (o.supplier_ref as string | null) ?? null,
    manufacturerRef: (o.manufacturer_ref as string | null) ?? null,
    ean: (o.ean as string | null) ?? null,
    designation: (o.designation as string | null) ?? null,
    matchStatus: o.match_status as OfferRow["matchStatus"],
    matchReason: (o.match_reason as string | null) ?? null,
    updatedAt: o.updated_at as string,
  };
}

const OFFER_COLUMNS = "id, supplier_id, product_id, accessory_id, public_price_cents, net_price_cents, discount_rate, discount_family, supplier_ref, manufacturer_ref, ean, designation, match_status, match_reason, updated_at";

export async function loadOffers(db: SupabaseClient, companyId: string, filter?: { productIds?: string[]; accessoryIds?: string[] }): Promise<OfferRow[]> {
  if (filter) {
    const out: OfferRow[] = [];
    for (const [col, ids] of [
      ["product_id", filter.productIds ?? []],
      ["accessory_id", filter.accessoryIds ?? []],
    ] as const) {
      for (let i = 0; i < ids.length; i += 200) {
        const { data, error } = await db
          .from("supplier_offers")
          .select(OFFER_COLUMNS)
          .eq("company_id", companyId)
          .in(col, ids.slice(i, i + 200));
        if (error) throw new Error(error.message);
        out.push(...(data ?? []).map(toOffer));
      }
    }
    return out;
  }
  const rows = await fetchAll<Record<string, unknown>>((from, to) => db.from("supplier_offers").select(OFFER_COLUMNS).eq("company_id", companyId).order("id").range(from, to) as never);
  return rows.map(toOffer);
}

export async function loadDiscountBook(db: SupabaseClient, companyId: string): Promise<DiscountBook> {
  const { data, error } = await db.from("supplier_discounts").select("supplier_id, brand_id, family_key, rate").eq("company_id", companyId);
  if (error) throw new Error(error.message);
  const book: DiscountBook = { brand: {}, family: {} };
  for (const d of data ?? []) {
    if (d.brand_id) (book.brand[d.supplier_id] ??= {})[d.brand_id] = Number(d.rate);
    else if (d.family_key) (book.family[d.supplier_id] ??= {})[familyKey(d.family_key)] = Number(d.rate);
  }
  return book;
}

/** Tout ce qu'il faut pour chiffrer avec les fournisseurs (filtré sur des articles si besoin). */
export async function loadSupplierBook(db: SupabaseClient, companyId: string, filter?: { productIds?: string[]; accessoryIds?: string[] }): Promise<SupplierBook> {
  const [suppliers, book, offers, brands, products] = await Promise.all([
    loadSuppliers(db, companyId),
    loadDiscountBook(db, companyId),
    loadOffers(db, companyId, filter),
    db.from("brands").select("id, reference_supplier_id").eq("company_id", companyId),
    filter?.productIds
      ? Promise.resolve({ data: null })
      : fetchAll<{ id: string; brand_id: string }>((from, to) => db.from("products").select("id, brand_id").eq("company_id", companyId).order("id").range(from, to) as never).then((data) => ({ data })),
  ]);
  const brandOf = new Map<string, string>();
  if (products.data) for (const p of products.data) brandOf.set(p.id, p.brand_id);
  else if (filter?.productIds?.length) {
    for (let i = 0; i < filter.productIds.length; i += 200) {
      const { data } = await db
        .from("products")
        .select("id, brand_id")
        .eq("company_id", companyId)
        .in("id", filter.productIds.slice(i, i + 200));
      for (const p of data ?? []) brandOf.set(p.id, p.brand_id);
    }
  }
  const active = new Set(suppliers.filter((s) => s.active).map((s) => s.id));
  const offersByProduct = new Map<string, OfferRow[]>();
  const offersByAccessory = new Map<string, OfferRow[]>();
  const probable: OfferRow[] = [];
  for (const o of offers) {
    if (o.matchStatus === "probable") {
      probable.push(o);
      continue;
    }
    if (!active.has(o.supplierId)) continue;
    const m = o.productId ? offersByProduct : offersByAccessory;
    const k = (o.productId ?? o.accessoryId)!;
    m.set(k, [...(m.get(k) ?? []), o]);
  }
  return {
    suppliers,
    book,
    offersByProduct,
    offersByAccessory,
    probable,
    brandOf,
    referenceSupplierOfBrand: new Map((brands.data ?? []).map((b) => [b.id, b.reference_supplier_id])),
  };
}

/** Prix nets classés d'un article. */
export function itemNetPrices(sb: SupplierBook, item: { productId?: string | null; accessoryId?: string | null }): NetPrice[] {
  if (item.productId) return rankOffers(sb.offersByProduct.get(item.productId) ?? [], sb.brandOf.get(item.productId) ?? null, sb.book);
  if (item.accessoryId) return rankOffers(sb.offersByAccessory.get(item.accessoryId) ?? [], null, sb.book);
  return [];
}

/**
 * Recalcule les prix de référence (prix client identique quel que soit le
 * fournisseur) puis les enregistre : prix public de référence des produits,
 * prix public et plancher d'achat des accessoires. À appeler après un import,
 * une modification de remise, d'offre ou de fournisseur de référence.
 */
export async function refreshReferencePrices(db: SupabaseClient, companyId: string): Promise<void> {
  const sb = await loadSupplierBook(db, companyId);
  const products: { id: string; public_price_cents: number }[] = [];
  for (const [productId, offers] of sb.offersByProduct) {
    const brandId = sb.brandOf.get(productId) ?? null;
    const ref = referencePublicPrice(offers, brandId ? (sb.referenceSupplierOfBrand.get(brandId) ?? null) : null);
    if (ref) products.push({ id: productId, public_price_cents: ref.cents });
  }
  const accessories: {
    id: string;
    public_price_cents: number | null;
    floor_purchase_cents: number | null;
  }[] = [];
  for (const [accessoryId, offers] of sb.offersByAccessory) {
    const ref = referencePublicPrice(offers, null);
    const nets = rankOffers(offers, null, sb.book);
    const floor = nets.length ? nets[nets.length - 1]!.netCents : null;
    if (ref || floor !== null)
      accessories.push({
        id: accessoryId,
        public_price_cents: ref?.cents ?? null,
        floor_purchase_cents: floor,
      });
  }
  for (let i = 0; i < Math.max(products.length, accessories.length); i += 500) {
    const { error } = await db.rpc("apply_reference_prices", {
      p_products: products.slice(i, i + 500),
      p_accessories: accessories.slice(i, i + 500),
    });
    if (error) throw new Error(error.message);
  }
}

/**
 * Catalogue affiché avec le prix d'achat du fournisseur le moins cher (et le
 * nombre de fournisseurs). Les articles sans tarif fournisseur gardent leur calcul.
 */
export function withSupplierPrices<T extends ProductItem | AccessoryItem>(items: T[], sb: SupplierBook, kind: "product" | "accessory"): (T & { supplierCount: number; bestSupplier: string | null })[] {
  const names = new Map(sb.suppliers.map((s) => [s.id, s.name]));
  return items.map((it) => {
    const nets = itemNetPrices(sb, kind === "product" ? { productId: it.id } : { accessoryId: it.id });
    const best = nets[0];
    if (!best) return { ...it, supplierCount: 0, bestSupplier: null };
    const pub = it.public_price_cents ?? 0;
    return {
      ...it,
      prices: {
        ...it.prices,
        purchaseCents: best.netCents,
        discount: pub > 0 ? Math.max(0, 1 - best.netCents / pub) : 0,
      },
      supplierCount: nets.length,
      bestSupplier: names.get(best.supplierId) ?? null,
    };
  });
}
