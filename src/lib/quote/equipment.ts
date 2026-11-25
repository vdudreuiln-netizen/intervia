/**
 * Choix du matériel pour une configuration (mono, multi, gainable) et une
 * marque donnée. Règles :
 *  - toujours une seule marque dans une configuration ;
 *  - unité intérieure : la plus petite puissance dans la plage cohérente
 *    [besoin × min ; besoin × max], sinon la plus petite au-dessus du besoin ;
 *  - mono : unité extérieure mono de la même marque, puissance ≥ unité intérieure ;
 *  - multi : 1 unité extérieure, ou 2 (même marque) si les sorties / la
 *    puissance ne suffisent pas, avec avertissement ;
 *  - gainable : si combles / faux plafond accessibles ; 2 gainables si les
 *    pièces sont sur 2 niveaux ou si la puissance dépasse la plus grosse gainable.
 */
import { catalogPrices } from "@/lib/pricing/engine";
import { checkMultiSplit, type SizingCoefficients } from "@/lib/sizing/sizing";
import type { ProductType } from "@/lib/catalog/import";
import type { CatProduct, ConfigKind, Equipment, IndoorChoice, RoomNeed, SavedSelection, System } from "./types";

export const INDOOR_TYPE: Record<IndoorChoice, ProductType> = { mural: "ui_murale", console: "ui_console", cassette: "ui_cassette" };
const MAX_ROOMS_EXACT_SPLIT = 12;

export interface EquipmentOptions {
  sizing: SizingCoefficients;
  /** Coefficient de simultanéité multi-split (1 = toutes les pièces à pleine charge). */
  multiSimultaneity: number;
  gainableAccess: boolean;
}

export type EquipmentResult = { ok: true; equipment: Equipment } | { ok: false; reason: string };

const kwOf = (p: CatProduct) => p.coolingKw ?? 0;
const sale = (p: CatProduct) =>
  catalogPrices({ kind: "material", publicPriceCents: p.publicPriceCents, brandDiscount: p.brandDiscount, productDiscount: p.productDiscount, brandCoefficient: p.brandCoefficient }).saleCents;
const byKwThenPrice = (a: CatProduct, b: CatProduct) => kwOf(a) - kwOf(b) || sale(a) - sale(b);
const fmtKw = (kw: number) => `${kw.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} kW`;

/** Unité de type `type` adaptée à un besoin en kW. */
export function pickIndoor(products: CatProduct[], type: ProductType, needKw: number, s: SizingCoefficients): { product: CatProduct; oversized: boolean } | null {
  const candidates = products.filter((p) => p.type === type && p.coolingKw).sort(byKwThenPrice);
  const inRange = candidates.find((p) => kwOf(p) >= needKw * s.unitMinRatio && kwOf(p) <= needKw * s.unitMaxRatio);
  if (inRange) return { product: inRange, oversized: false };
  const above = candidates.find((p) => kwOf(p) >= needKw * s.unitMinRatio);
  return above ? { product: above, oversized: true } : null;
}

/** Unité extérieure mono assortie à une unité intérieure (même marque, puissance ≥). */
export function pickMonoOutdoor(products: CatProduct[], indoor: CatProduct): CatProduct | null {
  return products.filter((p) => p.type === "ue_mono" && kwOf(p) >= kwOf(indoor) - 0.05).sort(byKwThenPrice)[0] ?? null;
}

/** Plus petite unité extérieure multi compatible avec un groupe d'unités intérieures. */
export function pickMultiOutdoor(products: CatProduct[], indoorKws: number[], totalNeedKw: number, simultaneity: number): CatProduct | null {
  return (
    products
      .filter((p) => p.type === "ue_multi" && p.coolingKw && p.maxOutlets)
      .sort(byKwThenPrice)
      .find(
        (p) =>
          checkMultiSplit({ coolingKw: kwOf(p), maxOutlets: p.maxOutlets!, maxIndoorRatio: p.maxIndoorRatio }, indoorKws).ok &&
          kwOf(p) >= totalNeedKw * simultaneity - 1e-9,
      ) ?? null
  );
}

/** Toutes les façons de couper une liste en deux groupes non vides (sans doublon miroir). */
function bipartitions<T>(items: T[]): [T[], T[]][] {
  const out: [T[], T[]][] = [];
  const n = items.length;
  for (let mask = 1; mask < 1 << (n - 1); mask++) {
    const a: T[] = [];
    const b: T[] = [];
    items.forEach((it, i) => ((mask >> i) & 1 ? a : b).push(it));
    // l'élément n-1 est toujours dans b : pas de doublon miroir
    out.push([a, b]);
  }
  return out;
}

function brandProducts(products: CatProduct[], brandId: string) {
  return products.filter((p) => p.brandId === brandId);
}

export function buildEquipment(kind: ConfigKind, brandId: string, rooms: RoomNeed[], allProducts: CatProduct[], o: EquipmentOptions): EquipmentResult {
  const products = brandProducts(allProducts, brandId);
  const brandName = products[0]?.brandName ?? "";
  if (rooms.length === 0) return { ok: false, reason: "Aucune pièce" };
  const warnings: string[] = [];

  // Unités intérieures par pièce (mono et multi)
  const pickRoomIndoor = (r: RoomNeed) => {
    const picked = pickIndoor(products, INDOOR_TYPE[r.indoorType], r.needW / 1000, o.sizing);
    if (picked?.oversized) warnings.push(`${r.name} : unité surdimensionnée (${fmtKw(kwOf(picked.product))} pour ${fmtKw(r.needW / 1000)})`);
    return picked?.product ?? null;
  };

  if (kind === "mono") {
    const systems: System[] = [];
    for (const r of rooms) {
      const indoor = pickRoomIndoor(r);
      if (!indoor) return { ok: false, reason: `Pas d'unité adaptée pour « ${r.name} »` };
      const outdoor = pickMonoOutdoor(products, indoor);
      if (!outdoor) return { ok: false, reason: `Pas d'unité extérieure mono pour « ${r.name} »` };
      systems.push({ key: `s${systems.length + 1}`, outdoor, indoors: [{ key: `i-${r.id}`, product: indoor, roomIds: [r.id] }] });
    }
    return { ok: true, equipment: { kind, brandId, brandName, systems, warnings } };
  }

  if (kind === "multi") {
    if (rooms.length < 2) return { ok: false, reason: "Multi-split : au moins 2 pièces" };
    const indoors = new Map<string, CatProduct>();
    for (const r of rooms) {
      const p = pickRoomIndoor(r);
      if (!p) return { ok: false, reason: `Pas d'unité adaptée pour « ${r.name} »` };
      indoors.set(r.id, p);
    }
    const groupSystem = (group: RoomNeed[], key: string): System | null => {
      const ue = pickMultiOutdoor(products, group.map((r) => kwOf(indoors.get(r.id)!)), group.reduce((a, r) => a + r.needW / 1000, 0), o.multiSimultaneity);
      return ue ? { key, outdoor: ue, indoors: group.map((r) => ({ key: `i-${r.id}`, product: indoors.get(r.id)!, roomIds: [r.id] })) } : null;
    };
    const single = groupSystem(rooms, "s1");
    if (single) return { ok: true, equipment: { kind, brandId, brandName, systems: [single], warnings } };
    if (rooms.length > MAX_ROOMS_EXACT_SPLIT) return { ok: false, reason: "Trop de pièces pour un multi-split" };
    // Deux unités extérieures : on garde la répartition la moins chère
    let best: { systems: System[]; price: number } | null = null;
    for (const [a, b] of bipartitions(rooms)) {
      if (a.length < 2 || b.length < 2) continue; // une seule pièce = un mono-split, pas un multi
      const sa = groupSystem(a, "s1");
      const sb = sa && groupSystem(b, "s2");
      if (!sa || !sb) continue;
      const price = sale(sa.outdoor) + sale(sb.outdoor);
      if (!best || price < best.price) best = { systems: [sa, sb], price };
    }
    if (!best) return { ok: false, reason: "Aucune combinaison multi-split possible dans cette marque" };
    warnings.unshift("2 unités extérieures");
    return { ok: true, equipment: { kind, brandId, brandName, systems: best.systems, warnings } };
  }

  // Gainable
  if (!o.gainableAccess) return { ok: false, reason: "Cochez « combles ou faux plafond accessibles » pour proposer un gainable" };
  const gainables = products.filter((p) => p.type === "ui_gainable" && p.coolingKw).sort(byKwThenPrice);
  if (gainables.length === 0) return { ok: false, reason: "Pas de gainable dans cette marque" };
  const maxKw = kwOf(gainables[gainables.length - 1]!) * o.sizing.unitMaxRatio;
  const levels = [...new Set(rooms.map((r) => r.level))].sort((x, y) => x - y);
  const need = (g: RoomNeed[]) => g.reduce((a, r) => a + r.needW / 1000, 0);

  let groups: RoomNeed[][];
  if (levels.length > 2) return { ok: false, reason: "Gainable : pièces sur plus de 2 niveaux" };
  if (levels.length === 2) {
    groups = levels.map((l) => rooms.filter((r) => r.level === l));
    warnings.unshift("2 gainables (pièces sur 2 niveaux)");
  } else if (need(rooms) > maxKw && rooms.length >= 2) {
    // Répartition la plus équilibrée en puissance
    const total = need(rooms);
    groups = bipartitions(rooms).sort(([a1], [a2]) => Math.abs(total - 2 * need(a1)) - Math.abs(total - 2 * need(a2)))[0]!;
    warnings.unshift("2 gainables (puissance supérieure à la plus grosse gainable)");
  } else groups = [rooms];

  const systems: System[] = [];
  for (const g of groups) {
    const picked = pickIndoor(products, "ui_gainable", need(g), o.sizing);
    if (!picked) return { ok: false, reason: `Puissance trop élevée pour une gainable (${fmtKw(need(g))})` };
    if (picked.oversized) warnings.push(`Gainable surdimensionnée (${fmtKw(kwOf(picked.product))} pour ${fmtKw(need(g))})`);
    const outdoor = pickMonoOutdoor(products, picked.product);
    if (!outdoor) return { ok: false, reason: "Pas d'unité extérieure assortie à la gainable" };
    const key = `s${systems.length + 1}`;
    systems.push({ key, outdoor, indoors: [{ key: `g-${key}`, product: picked.product, roomIds: g.map((r) => r.id) }] });
  }
  return { ok: true, equipment: { kind, brandId, brandName, systems, warnings } };
}

// ---------------------------------------------------------------------------
// Sauvegarde / relecture d'une sélection
// ---------------------------------------------------------------------------

export function toSelection(e: Equipment): SavedSelection {
  return {
    kind: e.kind,
    brandId: e.brandId,
    systems: e.systems.map((s) => ({ key: s.key, outdoorId: s.outdoor.id, indoors: s.indoors.map((i) => ({ key: i.key, productId: i.product.id, roomIds: i.roomIds })) })),
  };
}

/** Reconstitue l'équipement à partir des ids (null si un produit a disparu du catalogue). */
export function fromSelection(sel: SavedSelection, products: CatProduct[]): Equipment | null {
  const byId = new Map(products.map((p) => [p.id, p]));
  const systems: System[] = [];
  for (const s of sel.systems) {
    const outdoor = byId.get(s.outdoorId);
    if (!outdoor) return null;
    const indoors = [];
    for (const i of s.indoors) {
      const product = byId.get(i.productId);
      if (!product) return null;
      indoors.push({ key: i.key, product, roomIds: i.roomIds });
    }
    systems.push({ key: s.key, outdoor, indoors });
  }
  const brandName = systems[0]?.outdoor.brandName ?? "";
  const warnings: string[] = [];
  for (const s of systems) {
    if (s.outdoor.type === "ue_multi" && s.outdoor.coolingKw && s.outdoor.maxOutlets) {
      const c = checkMultiSplit({ coolingKw: s.outdoor.coolingKw, maxOutlets: s.outdoor.maxOutlets, maxIndoorRatio: s.outdoor.maxIndoorRatio }, s.indoors.map((i) => i.product.coolingKw ?? 0));
      warnings.push(...c.problems);
    }
  }
  if (sel.kind === "multi" && systems.length === 2) warnings.unshift("2 unités extérieures");
  if (sel.kind === "gainable" && systems.length === 2) warnings.unshift("2 gainables");
  return { kind: sel.kind, brandId: sel.brandId, brandName, systems, warnings };
}
