/**
 * Construction des lignes du devis à partir de l'équipement choisi et du métré.
 * Chaque ligne a une clé stable (pour cocher / décocher / forcer une quantité)
 * et ses prix viennent du moteur (catalogPrices) : rien n'est calculé ailleurs.
 */
import { catalogPrices, type QuoteLineInput, type TravelFee } from "@/lib/pricing/engine";
import { PRODUCT_TYPE_LABELS } from "@/lib/catalog/import";
import { DEFAULT_LABOR_DAYS, proposeLaborDays, type IndoorType, type LaborDaysParams } from "@/lib/sizing/sizing";
import { AUTO_ROLE_LABELS, type AutoRole, type CatAccessory, type CatProduct, type Equipment, type Metre, type RoomNeed } from "./types";

export const DEFAULT_LINK_M = 5;
export const DEFAULT_DUCT_M_PER_ROOM = 6;

export interface LineSettings {
  vatRate: number;
  dailyLaborRateCents: number;
  commissioningPriceCents: number;
  fluidFormPriceCents: number;
  fluidFormPolicy: "complement" | "always";
  defaultElectricM: number;
  companyAccessoryCoefficient: number;
  accessoryPurchaseCoefficient: number;
  /** Coefficients propres au devis (null = ceux des marques / des paramètres). */
  materialCoefficient: number | null;
  accessoryCoefficient: number | null;
}

export interface BuiltLine extends QuoteLineInput {
  key: string;
  group: string;
  enabled: boolean;
  /** Ligne décochable dans le métré. */
  optional: boolean;
  /** Lignes exclusives (ex. support mural OU au sol). */
  radioGroup?: string;
  productId?: string;
  accessoryId?: string;
  qtyEditable: boolean;
}

export interface BuildResult {
  lines: BuiltLine[];
  warnings: string[];
  /** Complément de charge (kg) par unité extérieure. */
  gasKg: Record<string, number>;
}

/** « 1/4" - 3/8" » → « 1/4-3/8 » pour comparer les diamètres. */
export function normalizeDiameter(d: string | null | undefined): string {
  return (d ?? "").replace(/["”″'\s]/g, "").replace(/[–—]/g, "-").toLowerCase();
}

/** Règle de repli si la fiche produit ne donne pas les diamètres. */
export function defaultDiameters(kw: number): string {
  if (kw <= 3.5) return "1/4 - 3/8";
  if (kw <= 5) return "1/4 - 1/2";
  return "3/8 - 5/8";
}

const INDOOR_LABOR: Partial<Record<CatProduct["type"], IndoorType>> = { ui_murale: "mural", ui_console: "console", ui_cassette: "cassette", ui_gainable: "gainable" };

export function linkLength(m: Metre, indoorKey: string) {
  return m.linkM[indoorKey] ?? DEFAULT_LINK_M;
}

/** Jours de main d'œuvre proposés pour l'équipement et le métré. */
export function proposeDays(eq: Equipment, m: Metre, p: LaborDaysParams & { zoningPerRoom?: number } = DEFAULT_LABOR_DAYS): number {
  const indoors = eq.systems.flatMap((s) => s.indoors);
  const base = proposeLaborDays(
    {
      outdoorUnits: eq.systems.length,
      indoorUnits: indoors.map((i) => INDOOR_LABOR[i.product.type] ?? "mural"),
      totalLinkMeters: indoors.reduce((a, i) => a + linkLength(m, i.key), 0),
    },
    p,
  );
  const zonedRooms = m.toggles["zonage"] ? indoors.filter((i) => i.product.type === "ui_gainable").reduce((a, i) => a + i.roomIds.length, 0) : 0;
  const extra = zonedRooms * (p.zoningPerRoom ?? 0.25);
  return extra > 0 ? Math.ceil((base + extra) / p.roundTo - 1e-9) * p.roundTo : base;
}

export function buildLines(
  eq: Equipment,
  rooms: RoomNeed[],
  m: Metre,
  accessories: CatAccessory[],
  s: LineSettings,
  laborDays: number,
  travel: TravelFee | null,
): BuildResult {
  const lines: BuiltLine[] = [];
  const warnings: string[] = [];
  const gasKg: Record<string, number> = {};
  const roomName = new Map(rooms.map((r) => [r.id, r.name]));
  const missingRoles = new Set<string>();

  const productLine = (key: string, group: string, p: CatProduct, label: string): BuiltLine => {
    const prices = catalogPrices({
      kind: "material",
      publicPriceCents: p.publicPriceCents,
      brandDiscount: p.brandDiscount,
      productDiscount: p.productDiscount,
      brandCoefficient: p.brandCoefficient,
      quoteCoefficient: s.materialCoefficient,
      netPurchaseCents: p.netPurchaseCents,
    });
    return {
      key,
      group,
      id: key,
      kind: "material",
      designation: label,
      quantity: 1,
      unit: "u",
      unitPurchaseCents: p.costHidden ? 0 : prices.purchaseCents,
      unitSaleCents: prices.saleCents,
      vatRate: s.vatRate,
      enabled: true,
      optional: false,
      productId: p.id,
      qtyEditable: true,
    };
  };

  const accessoryLine = (key: string, group: string, a: CatAccessory, defaultQty: number, opts: { label?: string; enabled?: boolean; optional?: boolean; radioGroup?: string } = {}): BuiltLine => {
    const prices =
      a.fixedSaleCents !== undefined
        ? { purchaseCents: 0, saleCents: a.fixedSaleCents, discount: 0 }
        : catalogPrices({
            kind: "accessory",
            publicPriceCents: a.publicPriceCents,
            purchasePriceCents: a.purchasePriceCents,
            discount: a.discount,
            companyCoefficient: s.companyAccessoryCoefficient,
            purchaseCoefficient: s.accessoryPurchaseCoefficient,
            quoteCoefficient: s.accessoryCoefficient,
            netPurchaseCents: a.netPurchaseCents,
            floorPurchaseCents: a.floorPurchaseCents,
          });
    const enabled = m.toggles[key] ?? opts.enabled ?? true;
    const quantity = Math.max(0, m.qty[key] ?? defaultQty);
    return {
      key,
      group,
      id: key,
      kind: "accessory",
      designation: opts.label ?? [a.name, a.diameter].filter(Boolean).join(" "),
      quantity,
      unit: a.unit,
      unitPurchaseCents: prices.purchaseCents,
      unitSaleCents: prices.saleCents,
      vatRate: s.vatRate,
      enabled,
      optional: opts.optional ?? true,
      radioGroup: opts.radioGroup,
      accessoryId: a.id,
      qtyEditable: true,
    };
  };

  const byRole = (role: AutoRole) => {
    const a = accessories.find((x) => x.role === role);
    if (!a) missingRoles.add(role);
    return a;
  };
  const add = (role: AutoRole, key: string, group: string, qty: number, opts?: Parameters<typeof accessoryLine>[4]) => {
    const a = byRole(role);
    if (a) lines.push(accessoryLine(key, group, a, qty, opts));
  };

  const serviceLine = (key: string, group: string, designation: string, priceCents: number): BuiltLine => ({
    key,
    group,
    id: key,
    kind: "other",
    designation: priceCents === 0 ? `${designation} (inclus)` : designation,
    quantity: m.qty[key] ?? 1,
    unit: "forfait",
    unitPurchaseCents: 0,
    unitSaleCents: priceCents,
    vatRate: s.vatRate,
    enabled: m.toggles[key] ?? true,
    optional: true,
    qtyEditable: false,
  });

  const kwLabel = (p: CatProduct) => (p.coolingKw ? ` ${p.coolingKw.toLocaleString("fr-FR")} kW` : "");
  const productLabel = (p: CatProduct, roomIds: string[]) =>
    `${PRODUCT_TYPE_LABELS[p.type]} ${p.brandName} ${p.reference}${kwLabel(p)}${roomIds.length ? ` – ${roomIds.map((id) => roomName.get(id) ?? "").join(", ")}` : ""}`;

  eq.systems.forEach((sys, si) => {
    const sysGroup = eq.systems.length > 1 ? `Unité extérieure ${si + 1}` : "Unité extérieure";
    lines.push(productLine(`eq:${sys.key}`, sysGroup, sys.outdoor, productLabel(sys.outdoor, [])));

    let systemLinkM = 0;
    for (const ind of sys.indoors) {
      const isGainable = ind.product.type === "ui_gainable";
      const names = ind.roomIds.map((id) => roomName.get(id) ?? "").join(", ");
      const group = isGainable ? `Gainable – ${names}` : names;
      lines.push(productLine(`eq:${ind.key}`, group, ind.product, productLabel(ind.product, ind.roomIds)));
      const linkM = linkLength(m, ind.key);
      systemLinkM += linkM;

      // Liaison frigorifique au diamètre de la fiche produit (ou règle de repli)
      const dia = ind.product.linkDiameters ?? sys.outdoor.linkDiameters ?? defaultDiameters(ind.product.coolingKw ?? 0);
      const liaison = accessories.find((a) => a.role === "liaison" && normalizeDiameter(a.diameter) === normalizeDiameter(dia));
      if (liaison) lines.push(accessoryLine(`liaison:${ind.key}`, group, liaison, linkM, { label: `Liaison frigorifique ${liaison.diameter ?? dia}`, optional: false }));
      else warnings.push(`Pas de liaison ${dia} dans le catalogue (rôle « liaison », diamètre « ${dia} »)`);

      add("goulotte", `goulotte:${ind.key}`, group, linkM);
      add("cable_liaison", `cablelia:${ind.key}`, group, linkM + 1);
      add("condensats", `condensats:${ind.key}`, group, linkM);
      add("pompe_relevage", `pompe:${ind.key}`, group, 1, { enabled: false });

      if (isGainable) {
        const n = ind.roomIds.length;
        const duct = m.ductMPerRoom[ind.key] ?? DEFAULT_DUCT_M_PER_ROOM;
        add("plenum", `plenum:${ind.key}`, group, 1);
        add("gaine", `gaine:${ind.key}`, group, n * duct);
        add("bouche_soufflage", `bouche:${ind.key}`, group, n);
        add("grille_reprise", `grille:${ind.key}`, group, 1);
        const zoning = m.toggles["zonage"] ?? false;
        for (const [role, key, qty] of [
          ["registre_zonage", `registre:${ind.key}`, n],
          ["thermostat_zone", `thermostat:${ind.key}`, n],
          ["module_zonage", `module:${ind.key}`, 1],
        ] as const) {
          const a = accessories.find((x) => x.role === role);
          if (a) lines.push({ ...accessoryLine(key, `${group} – zonage`, a, qty, { optional: false }), enabled: zoning });
          else if (zoning) missingRoles.add(role);
        }
      }
    }

    // Accessoires de l'unité extérieure
    add("support_mural", `support_mural:${sys.key}`, sysGroup, 1, { radioGroup: `support:${sys.key}`, enabled: true });
    add("support_sol", `support_sol:${sys.key}`, sysGroup, 1, { radioGroup: `support:${sys.key}`, enabled: false });
    add("cable_alim", `cable:${sys.key}`, sysGroup, m.electricM[sys.key] ?? s.defaultElectricM);
    add("disjoncteur", `disj:${sys.key}`, sysGroup, 1);

    // Complément de charge au-delà de la longueur pré-chargée
    let complement = 0;
    if (sys.outdoor.prechargedLengthM === null || sys.outdoor.extraChargeGPerM === null) {
      warnings.push(`${sys.outdoor.brandName} ${sys.outdoor.reference} : longueur pré-chargée ou charge au mètre non renseignée, complément de gaz non calculé`);
    } else {
      const extraM = Math.max(0, systemLinkM - sys.outdoor.prechargedLengthM);
      complement = extraM > 0 ? Math.ceil((extraM * sys.outdoor.extraChargeGPerM) / 100 - 1e-9) / 10 : 0; // arrondi au 0,1 kg supérieur
    }
    gasKg[sys.key] = complement;
    if (complement > 0) add("gaz", `gaz:${sys.key}`, sysGroup, complement, { label: `Complément de charge fluide (${systemLinkM} m de liaison)` });

    lines.push(serviceLine(`mes:${sys.key}`, sysGroup, "Mise en service : tirage au vide, test d'étanchéité à l'azote, contrôles", s.commissioningPriceCents));
    const gasUsed = complement > 0 && (m.toggles[`gaz:${sys.key}`] ?? true);
    if (s.fluidFormPolicy === "always" || gasUsed) {
      lines.push(serviceLine(`cerfa:${sys.key}`, sysGroup, "Fiche d'intervention fluides frigorigènes (CERFA 15497*04)", s.fluidFormPriceCents));
    }
  });

  // Main d'œuvre et déplacement
  lines.push({
    key: "mo",
    group: "Main d'œuvre et déplacement",
    id: "mo",
    kind: "labor",
    designation: "Main d'œuvre : pose et raccordements",
    quantity: laborDays,
    unit: "jour",
    unitPurchaseCents: 0,
    unitSaleCents: s.dailyLaborRateCents,
    vatRate: s.vatRate,
    enabled: laborDays > 0,
    optional: false,
    qtyEditable: false,
  });
  if (travel?.applies) {
    lines.push({
      key: "dep",
      group: "Main d'œuvre et déplacement",
      id: "dep",
      kind: "travel",
      designation: `${travel.designation} (${travel.detail})`,
      quantity: 1,
      unit: "forfait",
      unitPurchaseCents: 0,
      unitSaleCents: travel.totalCents,
      vatRate: s.vatRate,
      enabled: true,
      optional: false,
      qtyEditable: false,
    });
  }

  // Support mural OU au sol : au plus un coché par unité extérieure
  const radios = new Map<string, BuiltLine[]>();
  for (const l of lines) if (l.radioGroup) radios.set(l.radioGroup, [...(radios.get(l.radioGroup) ?? []), l]);
  for (const group of radios.values()) {
    let seen = false;
    for (const l of group) {
      if (l.enabled && seen) l.enabled = false;
      if (l.enabled) seen = true;
    }
  }

  for (const role of missingRoles) warnings.push(`Aucun accessoire « ${AUTO_ROLE_LABELS[role as AutoRole]} » dans votre catalogue : ligne non ajoutée`);
  return { lines, warnings, gasKg };
}

/** Lignes réellement retenues pour le devis (cochées, quantité > 0). */
export function enabledLines(lines: BuiltLine[]): QuoteLineInput[] {
  return lines
    .filter((l) => l.enabled && l.quantity > 0)
    .map(({ id, kind, designation, quantity, unit, unitPurchaseCents, unitSaleCents, vatRate }) => ({ id, kind, designation, quantity, unit, unitPurchaseCents, unitSaleCents, vatRate }));
}
