import { describe, expect, it } from "vitest";
import { computeQuote } from "@/lib/pricing/engine";
import { buildLines, enabledLines, type LineSettings } from "./lines";
import { sanitizeAccessory, sanitizeProduct, sanitizeResult } from "./sanitize";
import { EMPTY_METRE, type CatAccessory, type CatProduct, type Equipment } from "./types";

const LS: LineSettings = { vatRate: 0, dailyLaborRateCents: 45000, commissioningPriceCents: 0, fluidFormPriceCents: 0, fluidFormPolicy: "always", defaultElectricM: 10, companyAccessoryCoefficient: 1.3, accessoryPurchaseCoefficient: 2, materialCoefficient: null, accessoryCoefficient: null };
const ue: CatProduct = { id: "ue", brandId: "b", brandName: "B", reference: "UE35", rangeName: null, type: "ue_mono", coolingKw: 3.5, heatingKw: 4, maxOutlets: 1, maxIndoorRatio: null, linkDiameters: "1/4 - 3/8", prechargedLengthM: 7.5, extraChargeGPerM: 20, publicPriceCents: 109000, brandDiscount: 0.35, productDiscount: 0.42, brandCoefficient: 1.1 };
const ui: CatProduct = { ...ue, id: "ui", type: "ui_murale", reference: "MU35", publicPriceCents: 54000 };
const lia: CatAccessory = { id: "l", role: "liaison", category: "liaison", name: "Liaison", diameter: "1/4 - 3/8", unit: "m", publicPriceCents: 1200, purchasePriceCents: null, discount: 0.3 };
const eq = (u: CatProduct, i: CatProduct): Equipment => ({ kind: "mono", brandId: "b", brandName: "B", systems: [{ key: "s1", outdoor: u, indoors: [{ key: "i1", product: i, roomIds: ["r"] }] }], warnings: [] });
const rooms = [{ id: "r", name: "Salon", needW: 3140, level: 0, indoorType: "mural" as const }];

describe("données nettoyées pour un technicien sans accès aux marges", () => {
  it("aucune remise ni coût transmis, mêmes prix de vente", () => {
    const full = buildLines(eq(ue, ui), rooms, EMPTY_METRE, [lia], LS, 1, null).lines;
    const safeAcc = sanitizeAccessory(lia, LS);
    const safe = buildLines(eq(sanitizeProduct(ue), sanitizeProduct(ui)), rooms, EMPTY_METRE, [safeAcc], LS, 1, null).lines;
    expect(safe.map((l) => l.unitSaleCents)).toEqual(full.map((l) => l.unitSaleCents));
    expect(safe.every((l) => l.unitPurchaseCents === 0)).toBe(true);
    expect(JSON.stringify(safeAcc)).not.toMatch(/"discount":0\.3|"publicPriceCents":1200/);
    expect(sanitizeProduct(ue)).toMatchObject({ brandDiscount: 0, productDiscount: null });
  });
  it("résultat : marges et coûts à zéro, alertes conservées", () => {
    const lines = enabledLines(buildLines(eq(ue, ui), rooms, EMPTY_METRE, [lia], LS, 1, null).lines);
    const r = computeQuote({ lines, laborDays: 1, settings: { vatRegime: "franchise", laborChargesRate: 0.23, materialChargesRate: 0.16, targetMarginPerDayCents: 999999 } });
    const s = sanitizeResult(r);
    expect(s.alerts).toEqual(r.alerts);
    expect(s.margin.netMarginCents).toBe(0);
    expect(s.lines.every((l) => l.totalPurchaseCents === 0 && l.contributionCents === 0)).toBe(true);
    expect(s.totalTtcCents).toBe(r.totalTtcCents);
  });
});
