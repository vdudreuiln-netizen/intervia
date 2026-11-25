/** Vues des tarifs fournisseurs d'un article (pour l'écran de l'article, membres autorisés). */
import { DISCOUNT_LEVEL_LABELS, netPurchase, resolveDiscount, type DiscountBook, type SupplierOffer } from "./pricing";

export interface OfferView {
  supplierId: string;
  supplierName: string;
  supplierRef: string | null;
  publicPriceCents: number | null;
  discount: number | null;
  netCents: number | null;
  levelLabel: string;
  rate: number;
  probable: boolean;
  isReference: boolean;
}

export interface ItemPricing {
  suppliers: { id: string; name: string }[];
  offers: OfferView[];
  fallbackBySupplier: Record<string, number>;
  defaultSupplierId: string | null;
}

/** Construit la vue : tarifs triés du moins cher au plus cher, remise de repli par fournisseur. */
export function buildItemPricing(input: {
  suppliers: { id: string; name: string; active: boolean }[];
  offers: (SupplierOffer & {
    supplierRef: string | null;
    matchStatus: string;
  })[];
  brandId: string | null;
  book: DiscountBook;
  referenceSupplierId: string | null;
  referencePublicCents: number | null;
}): ItemPricing {
  const names = new Map(input.suppliers.map((s) => [s.id, s.name]));
  const offers: OfferView[] = input.offers
    .map((o) => {
      const n = o.purchasable === false ? null : netPurchase(o, input.brandId, input.book);
      return {
        supplierId: o.supplierId,
        supplierName: names.get(o.supplierId) ?? "?",
        supplierRef: o.supplierRef,
        publicPriceCents: o.publicPriceCents,
        discount: o.discount,
        netCents: n?.netCents ?? null,
        levelLabel: o.purchasable === false ? "Tarif fabricant (prix public)" : n ? DISCOUNT_LEVEL_LABELS[n.level] : "Prix incomplet",
        rate: n?.rate ?? 0,
        probable: o.matchStatus === "probable",
        isReference: false,
      };
    })
    .sort((a, b) => Number(a.probable) - Number(b.probable) || (a.netCents ?? Infinity) - (b.netCents ?? Infinity));
  // Prix public de référence : fournisseur de référence de la marque, sinon le plus élevé
  const ref = offers.find((o) => !o.probable && o.supplierId === input.referenceSupplierId && o.publicPriceCents !== null) ?? offers.filter((o) => !o.probable && o.publicPriceCents === input.referencePublicCents)[0];
  if (ref) ref.isReference = true;
  const fallbackBySupplier: Record<string, number> = {};
  for (const s of input.suppliers) {
    const own = input.offers.find((o) => o.supplierId === s.id);
    fallbackBySupplier[s.id] = resolveDiscount(
      {
        supplierId: s.id,
        publicPriceCents: null,
        netPriceCents: null,
        discount: null,
        family: own?.family ?? null,
      },
      input.brandId,
      input.book,
    ).rate;
  }
  const active = input.suppliers.filter((s) => s.active);
  const defaultSupplierId = input.referenceSupplierId && active.some((s) => s.id === input.referenceSupplierId) ? input.referenceSupplierId : (offers.find((o) => !o.probable)?.supplierId ?? active[0]?.id ?? null);
  return {
    suppliers: active.map((s) => ({ id: s.id, name: s.name })),
    offers,
    fallbackBySupplier,
    defaultSupplierId,
  };
}
