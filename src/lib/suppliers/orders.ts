/**
 * Bons de commande fournisseur (un par fournisseur retenu, devis accepté).
 * Module PUR : construit le contenu du document ; le rendu PDF est ailleurs.
 *
 * Contenu validé : référence fournisseur + référence fabricant, quantité, prix
 * net attendu, date de génération, livraison au dépôt (défaut) ou sur chantier,
 * « référence chantier » (nom du client + ville, AUCUN prix client) et date de
 * livraison souhaitée. Pas de suivi de stock.
 */
import { roundCents } from "@/lib/pricing/engine";

export interface OrderLineInput {
  supplierId: string | null;
  supplierRef: string | null;
  manufacturerRef: string | null;
  designation: string;
  quantity: number;
  unit: string;
  unitNetCents: number;
}

export interface OrderSupplier {
  id: string;
  name: string;
  agency: string | null;
  contactName: string | null;
  email: string | null;
  phone: string | null;
}

export interface Address {
  line: string | null;
  postalCode: string | null;
  city: string | null;
}

export interface PurchaseOrderInput {
  quoteNumber: string;
  clientName: string;
  siteCity: string | null;
  delivery: "depot" | "chantier";
  depotAddress: Address;
  siteAddress: Address;
  desiredDate: string | null; // AAAA-MM-JJ
  generatedAt: Date;
  shippingBySupplier: Record<string, number>;
}

export interface PurchaseOrderLine {
  supplierRef: string;
  manufacturerRef: string;
  designation: string;
  quantity: number;
  unit: string;
  unitNetCents: number;
  totalNetCents: number;
}

export interface PurchaseOrder {
  supplier: OrderSupplier;
  /** Numéro lisible : BC-<n° devis>-<initiales fournisseur>. */
  number: string;
  siteReference: string;
  deliveryLabel: string;
  deliveryAddress: string;
  desiredDate: string | null;
  generatedAt: Date;
  lines: PurchaseOrderLine[];
  subtotalCents: number;
  shippingCents: number;
  totalCents: number;
}

const fmtAddress = (a: Address) => [a.line, [a.postalCode, a.city].filter(Boolean).join(" ")].filter((x) => x && x.trim()).join(", ");

function initials(name: string): string {
  const w = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .match(/[A-Z0-9]+/g) ?? ["F"];
  return w.length === 1
    ? w[0]!.slice(0, 3)
    : w
        .map((x) => x[0])
        .join("")
        .slice(0, 4);
}

export function siteReference(clientName: string, siteCity: string | null): string {
  return [clientName.trim(), siteCity?.trim()].filter(Boolean).join(" – ");
}

/** Date souhaitée valide : format AAAA-MM-JJ, pas avant la date de génération. */
export function validateDesiredDate(value: string | null, today: Date): string | null {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(new Date(`${value}T00:00:00Z`).getTime())) return "Date de livraison invalide.";
  const t = today.toISOString().slice(0, 10);
  if (value < t) return "La date de livraison souhaitée est déjà passée.";
  return null;
}

export function buildPurchaseOrders(lines: OrderLineInput[], suppliers: OrderSupplier[], input: PurchaseOrderInput): PurchaseOrder[] {
  const ref = siteReference(input.clientName, input.siteCity);
  const deliveryLabel = input.delivery === "chantier" ? "Livraison sur le chantier" : "Livraison au dépôt";
  const deliveryAddress = fmtAddress(input.delivery === "chantier" ? input.siteAddress : input.depotAddress);
  const orders: PurchaseOrder[] = [];
  for (const s of suppliers) {
    const mine = lines.filter((l) => l.supplierId === s.id && l.quantity > 0);
    if (mine.length === 0) continue;
    const out: PurchaseOrderLine[] = mine.map((l) => ({
      supplierRef: l.supplierRef ?? "",
      manufacturerRef: l.manufacturerRef ?? "",
      designation: l.designation,
      quantity: l.quantity,
      unit: l.unit,
      unitNetCents: l.unitNetCents,
      totalNetCents: roundCents(l.quantity * l.unitNetCents),
    }));
    const subtotalCents = out.reduce((a, l) => a + l.totalNetCents, 0);
    const shippingCents = input.shippingBySupplier[s.id] ?? 0;
    orders.push({
      supplier: s,
      number: `BC-${input.quoteNumber}-${initials(s.name)}`,
      siteReference: ref,
      deliveryLabel,
      deliveryAddress,
      desiredDate: input.desiredDate,
      generatedAt: input.generatedAt,
      lines: out,
      subtotalCents,
      shippingCents,
      totalCents: subtotalCents + shippingCents,
    });
  }
  return orders;
}
