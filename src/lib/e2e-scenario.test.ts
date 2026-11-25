/**
 * Scénario de bout en bout (fonctions pures, sans base) :
 * implantation → métré et lignes du devis → aucune vente à perte → CERFA → avenant → tableau de bord.
 * Le parcours réel avec Supabase est décrit dans MISE-EN-LIGNE.md (partie G).
 */
import { describe, expect, it } from "vitest";
import { computeQuote } from "@/lib/pricing/engine";
import { metreFromLayouts, type Layout } from "@/lib/plans/layout";
import { buildLines, enabledLines, type LineSettings } from "@/lib/quote/lines";
import { lossLines, sellsAtLoss } from "@/lib/quote/edits";
import { EMPTY_METRE, type CatAccessory, type CatProduct, type Equipment } from "@/lib/quote/types";
import { buildCerfaSheets } from "@/lib/site/cerfa";
import { buildAmendment } from "@/lib/site/site";
import { monthStats } from "@/lib/dashboard/stats";

const product = (id: string, type: CatProduct["type"]): CatProduct => ({
  id, brandId: "b", brandName: "Arctica", reference: id.toUpperCase(), rangeName: null, type, coolingKw: 3.5, heatingKw: 4, maxOutlets: 1, maxIndoorRatio: null,
  linkDiameters: "1/4 - 3/8", prechargedLengthM: 5, extraChargeGPerM: 20, publicPriceCents: 100000, brandDiscount: 0.4, productDiscount: null, brandCoefficient: 1,
});
const equipment: Equipment = { kind: "mono", brandId: "b", brandName: "Arctica", warnings: [], systems: [{ key: "s1", outdoor: product("ue", "ue_mono"), indoors: [{ key: "i1", product: product("mu", "ui_murale"), roomIds: ["r1"] }] }] };
const acc = (role: CatAccessory["role"], name: string, unit: string, price: number, diameter: string | null = null): CatAccessory => ({ id: `a-${role}`, role, category: "x", name, diameter, unit, publicPriceCents: price, purchasePriceCents: null, discount: 0.3 });
const ACC = [
  acc("liaison", "Liaison", "m", 1200, "1/4 - 3/8"), acc("goulotte", "Goulotte", "m", 1400), acc("condensats", "Condensats", "m", 250), acc("cable_liaison", "Câble 4G1,5", "m", 220),
  acc("support_mural", "Support mural", "u", 4500), acc("support_sol", "Support sol", "u", 6000), acc("cable_alim", "Câble 3G2,5", "m", 280), acc("disjoncteur", "Disjoncteur", "u", 1800),
  acc("gaz", "R32", "kg", 4500), acc("fixation_chimique", "Kit de scellement chimique", "u", 3900), acc("fixation_ite", "Fixation ITE", "u", 14900), acc("support_toiture", "Support toiture", "u", 18900),
];
const LS: LineSettings = { vatRate: 0.1, dailyLaborRateCents: 45000, commissioningPriceCents: 0, fluidFormPriceCents: 0, fluidFormPolicy: "complement", defaultElectricM: 10, companyAccessoryCoefficient: 1.3, accessoryPurchaseCoefficient: 2, materialCoefficient: null, accessoryCoefficient: null };
const settings = { vatRegime: "assujetti" as const, laborChargesRate: 0.2, materialChargesRate: 0.1, targetMarginPerDayCents: 0 };

describe("scénario complet : création, implantation, CERFA, avenant, tableau de bord", () => {
  it("de l'implantation au chiffre d'affaires", () => {
    // 1. Implantation : UE sur chevilles chimiques, sol dégagé ; liaison de 12 m (1 px = 1 cm)
    const layout: Layout = {
      markers: [
        { id: "u", kind: "ui", x: 100, y: 100, equipmentKey: "i1", support: "mur_plein", poseHeightM: 1.8 },
        { id: "e", kind: "ue", x: 100, y: 1300, equipmentKey: "s1", mount: "mural_bas", support: "chevilles_chimiques", confirmed: ["degagements", "sol_degage"] },
      ],
      routes: [{ id: "l", kind: "liaison", equipmentKey: "i1", points: [{ x: 100, y: 100 }, { x: 100, y: 1300 }], extraM: 0 }],
    };
    const { metre } = metreFromLayouts([{ level: 0, mPerPx: 0.01, layout }], equipment, EMPTY_METRE);
    expect(metre.linkM.i1).toBe(12);
    expect(metre.fixation).toEqual({ i1: "mur_plein", s1: "chevilles_chimiques" });

    // 2. Devis : la fourniture du support vérifié est ajoutée automatiquement, sans vente à perte
    const { lines } = buildLines(equipment, [{ id: "r1", name: "Séjour", needW: 3000, level: 0, indoorType: "mural" }], metre, ACC, LS, 1, null);
    const enabled = enabledLines(lines);
    expect(lines.filter((l) => l.enabled).map((l) => l.key)).toEqual(expect.arrayContaining(["support_mural:s1", "fixation_chimique:s1"]));
    const quote = computeQuote({ lines: enabled, laborDays: 1, settings });
    expect(lossLines(quote.lines)).toEqual([]);
    expect(quote.lines.every((l) => !sellsAtLoss(l.unitSaleCents, l.unitPurchaseCents))).toBe(true);

    // 3. CERFA : charge usine 0,95 kg + complément (12 − 5 m) × 20 g = 0,2 kg
    const [cerfa] = buildCerfaSheets({
      country: "FR", number: "FI-2026-0001",
      company: { name: "Clim Test", address: "Bordeaux", siret: "12345678900011", capacityNumber: "AC-1", leakDetectorId: "Testo", leakDetectorCheckedOn: "2026-03-02" },
      client: { name: "M. Martin", address: "Pessac", siret: null }, installationAddress: "Pessac",
      equipment, metre, tech: { ue: { refrigerant: "R32", factoryChargeKg: 0.95, maxLinkM: 20, maxHeightDiffM: 10, clearances: {} } },
      commissioning: { "s1.serial": "SN-1" }, form: { systems: {} },
    });
    expect(cerfa!.equipment.totalChargeKg).toBe(1.15);
    expect(cerfa!.charged.a).toBe(0.2);
    expect(cerfa!.leakCheckMonths).toBeNull();
    expect(cerfa!.warnings).toEqual([]);

    // 4. Avenant accepté : 1 pompe de relevage vendue 156 € HT
    const am = buildAmendment(1, [{ description: "Pompe de relevage", lines: [{ designation: "Pompe de relevage", quantity: 1, unit: "u", kind: "accessory", unitPurchaseCents: 8400, unitSaleCents: 15600, vatRate: 0.1 }] }], settings, quote.totalTtcCents);
    expect(am.totalHtCents).toBe(15600);

    // 5. Tableau de bord : devis signé + avenant accepté
    const stats = monthStats(
      [{ id: "q", status: "accepte", totalHtCents: quote.totalHtCents, netMarginCents: quote.margin.netMarginCents, createdAt: "2026-11-02T09:00:00Z", sentAt: "2026-11-03T09:00:00Z", decidedAt: "2026-11-05T09:00:00Z", lastFollowUpAt: null }],
      "2026-11",
      [{ quoteId: "q", totalHtCents: am.totalHtCents, marginCents: 7200, decidedAt: "2026-11-20T09:00:00Z" }],
    );
    expect(stats.initialHtCents).toBe(quote.totalHtCents);
    expect(stats.amendmentsHtCents).toBe(15600);
    expect(stats.signedHtCents).toBe(quote.totalHtCents + 15600);
  });
});
