import { describe, expect, it } from "vitest";
import {
  computeQuote,
  computeTravelFee,
  effectiveDiscount,
  effectiveSaleCoefficient,
  materialSalePriceCents,
  FRANCHISE_MENTION,
  isPsychologicalPrice,
  psychologicalBounds,
  purchasePriceCents,
  roundToPsychologicalPrice,
  type PricingSettings,
  type QuoteInput,
  type QuoteLineInput,
  type TravelSettings,
} from "./engine";

const franchise: PricingSettings = {
  vatRegime: "franchise",
  laborChargesRate: 0.212,
  materialChargesRate: 0.123,
  targetMarginPerDayCents: 0,
};
const assujetti: PricingSettings = { ...franchise, vatRegime: "assujetti" };

function lines(): QuoteLineInput[] {
  return [
    { id: "ue", kind: "material", designation: "Mono-split 3,5 kW", quantity: 1, unit: "u", unitPurchaseCents: 100000, unitSaleCents: 150000, vatRate: 0.2 },
    { id: "liaison", kind: "accessory", designation: "Liaison 1/4-3/8", quantity: 5, unit: "m", unitPurchaseCents: 1200, unitSaleCents: 2000, vatRate: 0.2 },
    { id: "mo", kind: "labor", designation: "Main d'œuvre", quantity: 2, unit: "jour", unitPurchaseCents: 0, unitSaleCents: 45000, vatRate: 0.1 },
    { id: "dep", kind: "travel", designation: "Frais de déplacement", quantity: 1, unit: "forfait", unitPurchaseCents: 0, unitSaleCents: 4000, vatRate: 0.1 },
  ];
}
const quote = (settings: PricingSettings, l = lines(), laborDays = 2): QuoteInput => ({ lines: l, laborDays, settings });

describe("remises fournisseur et prix d'achat", () => {
  it("la remise produit écrase la remise marque", () => {
    expect(effectiveDiscount(0.3, 0.4)).toBe(0.4);
  });
  it("la remise marque s'applique si le produit n'a pas de remise propre", () => {
    expect(effectiveDiscount(0.3, null)).toBe(0.3);
    expect(effectiveDiscount(0.3, undefined)).toBe(0.3);
  });
  it("une remise produit à 0 % est une vraie valeur et écrase la marque", () => {
    expect(effectiveDiscount(0.3, 0)).toBe(0);
  });
  it("aucune remise renseignée = 0", () => {
    expect(effectiveDiscount(null, null)).toBe(0);
  });
  it("refuse une remise hors bornes", () => {
    expect(() => effectiveDiscount(1.2, null)).toThrow(RangeError);
    expect(() => effectiveDiscount(null, -0.1)).toThrow(RangeError);
  });
  it("prix d'achat = prix public × (1 − remise), arrondi au centime", () => {
    expect(purchasePriceCents(123456, 0.35)).toBe(80246); // 802,464 € → 802,46 €
    expect(purchasePriceCents(99999, 0.425)).toBe(57499); // 574,994 € → 574,99 €
    expect(purchasePriceCents(100000, 0)).toBe(100000);
  });
});

describe("calcul du devis et de la marge", () => {
  it("calcule totaux, charges et marge nette (franchise en base)", () => {
    const r = computeQuote(quote(franchise));
    expect(r.totalHtCents).toBe(254000);
    expect(r.totalVatCents).toBe(0);
    expect(r.totalTtcCents).toBe(254000);
    expect(r.vatMention).toBe(FRANCHISE_MENTION);
    expect(r.lines.every((l) => l.vatRate === 0)).toBe(true);
    expect(r.margin.purchaseCostCents).toBe(106000);
    expect(r.margin.materialSaleCents).toBe(160000);
    expect(r.margin.laborSaleCents).toBe(90000);
    expect(r.margin.travelSaleCents).toBe(4000);
    expect(r.margin.materialChargesCents).toBe(19680); // 12,3 % × 1 600 €
    expect(r.margin.laborChargesCents).toBe(19928); // 21,2 % × (900 € + 40 €)
    expect(r.margin.netMarginCents).toBe(108392);
    expect(r.margin.marginPerDayCents).toBe(54196);
    expect(r.alerts).toEqual([]);
  });

  it("assujetti : TVA par taux sur le total HT de chaque taux", () => {
    const r = computeQuote(quote(assujetti));
    expect(r.vat).toEqual([
      { rate: 0.1, baseCents: 94000, vatCents: 9400 },
      { rate: 0.2, baseCents: 160000, vatCents: 32000 },
    ]);
    expect(r.totalTtcCents).toBe(295400);
    expect(r.vatMention).toBeNull();
    // la TVA ne change pas la marge
    expect(r.margin.netMarginCents).toBe(108392);
  });

  it("gère les quantités décimales au centime près", () => {
    const l = lines();
    l[1] = { ...l[1]!, quantity: 7.5, unitSaleCents: 1999 }; // 149,925 € → 149,93 €
    const r = computeQuote(quote(franchise, l));
    expect(r.lines[1]!.totalSaleCents).toBe(14993);
  });

  it("marge par jour = null si 0 jour de chantier", () => {
    expect(computeQuote(quote(franchise, lines(), 0)).margin.marginPerDayCents).toBeNull();
  });
});

describe("alertes", () => {
  it("alerte si une ligne est vendue sous son prix d'achat", () => {
    const l = lines();
    l[0] = { ...l[0]!, unitSaleCents: 90000 };
    const r = computeQuote(quote(franchise, l));
    expect(r.lines[0]!.belowCost).toBe(true);
    expect(r.alerts.map((a) => a.code)).toContain("line_below_cost");
    expect(r.alerts.find((a) => a.code === "line_below_cost")!.lineId).toBe("ue");
  });

  it("alerte si la vente couvre l'achat mais pas les charges (coût de revient)", () => {
    const l = lines();
    // vendu 1 050 € pour 1 000 € d'achat : 12,3 % de charges = 129,15 € → perte
    l[0] = { ...l[0]!, unitSaleCents: 105000 };
    expect(computeQuote(quote(franchise, l)).lines[0]!.belowCost).toBe(true);
  });

  it("pas d'alerte quand la vente couvre achat + charges", () => {
    const l = lines();
    l[0] = { ...l[0]!, unitSaleCents: 115000 }; // 1150 − 1000 − 141,45 = 8,55 € > 0
    expect(computeQuote(quote(franchise, l)).lines[0]!.belowCost).toBe(false);
  });

  it("alerte si la marge par jour est sous l'objectif", () => {
    const r = computeQuote(quote({ ...franchise, targetMarginPerDayCents: 60000 }));
    expect(r.alerts.map((a) => a.code)).toEqual(["margin_below_target"]);
  });

  it("pas d'alerte si la marge par jour atteint exactement l'objectif", () => {
    const r = computeQuote(quote({ ...franchise, targetMarginPerDayCents: 54196 }));
    expect(r.alerts).toEqual([]);
  });

  it("alerte si la marge nette totale est négative", () => {
    const l = lines().map((x) => ({ ...x, unitSaleCents: Math.round(x.unitPurchaseCents * 0.5) }));
    const r = computeQuote(quote(franchise, l));
    expect(r.alerts.map((a) => a.code)).toContain("negative_margin");
  });

  it("refuse une quantité négative", () => {
    const l = lines();
    l[0] = { ...l[0]!, quantity: -1 };
    expect(() => computeQuote(quote(franchise, l))).toThrow(RangeError);
  });
});

describe("frais de déplacement et stationnement", () => {
  const s: TravelSettings = { pricePerKmCents: 50, minimumFeeCents: 3000, minimumDailyWithParkingCents: 6000 };
  const noParking = { enabled: false, perDayCents: 4000 };
  const bordeaux = { enabled: true, perDayCents: 4000 };

  it("aucun frais de déplacement si le chantier est dans la commune de l'artisan", () => {
    const f = computeTravelFee({ oneWayKm: 3, sameCommune: true, trips: 2, parking: noParking }, s);
    expect(f.applies).toBe(false);
    expect(f.totalCents).toBe(0);
  });
  it("dans la commune, le stationnement activé reste facturé (sans minimum)", () => {
    const f = computeTravelFee({ oneWayKm: 3, sameCommune: true, trips: 2, parking: bordeaux }, s);
    expect(f.totalCents).toBe(8000);
    expect(f.designation).toBe("Stationnement");
  });
  it("prix au km sur l'aller-retour, un aller-retour par jour", () => {
    // 42 km aller → 84 km A/R × 0,50 € = 42 € par jour, × 2 jours
    const f = computeTravelFee({ oneWayKm: 42, sameCommune: false, trips: 2, parking: noParking }, s);
    expect(f.perTripCents).toBe(4200);
    expect(f.totalCents).toBe(8400);
  });
  it("applique le forfait minimum par aller-retour", () => {
    const f = computeTravelFee({ oneWayKm: 10, sameCommune: false, trips: 1, parking: noParking }, s);
    expect(f.perTripCents).toBe(3000); // 20 km × 0,50 = 10 € < 30 €
  });
  it("Bordeaux : stationnement 40 €/j avec minimum déplacement + stationnement de 60 €/j", () => {
    // 10 € de km → minimum 30 € + 40 € de stationnement = 70 € > 60 €
    const near = computeTravelFee({ oneWayKm: 10, sameCommune: false, trips: 2, parking: bordeaux }, { ...s, minimumFeeCents: 0 });
    expect(near.perDayCents).toBe(6000); // 10 € + 40 € = 50 € → relevé à 60 €
    expect(near.totalCents).toBe(12000);
    const far = computeTravelFee({ oneWayKm: 42, sameCommune: false, trips: 2, parking: bordeaux }, s);
    expect(far.perDayCents).toBe(8200); // 42 € + 40 € = 82 € > 60 €
    expect(far.designation).toBe("Déplacement et stationnement");
  });
  it("le minimum journalier avec stationnement ne s'applique pas sans stationnement", () => {
    const f = computeTravelFee({ oneWayKm: 42, sameCommune: false, trips: 1, parking: noParking }, { ...s, minimumDailyWithParkingCents: 10000 });
    expect(f.totalCents).toBe(4200);
  });
  it("un demi-jour compte comme un aller-retour entier", () => {
    const f = computeTravelFee({ oneWayKm: 42, sameCommune: false, trips: 1.5, parking: noParking }, s);
    expect(f.totalCents).toBe(8400);
  });
});

describe("coefficient de vente du matériel", () => {
  it("1,00 = prix public par défaut", () => {
    expect(effectiveSaleCoefficient(null, null)).toBe(1);
    expect(materialSalePriceCents(109000, 1)).toBe(109000);
  });
  it("coefficient de la marque : 1,10 = prix public + 10 %", () => {
    expect(materialSalePriceCents(109000, effectiveSaleCoefficient(1.1, null))).toBe(119900);
  });
  it("le coefficient du devis remplace celui de la marque", () => {
    expect(effectiveSaleCoefficient(1.1, 1.05)).toBe(1.05);
    expect(effectiveSaleCoefficient(1.1, 1)).toBe(1);
  });
  it("refuse un coefficient nul ou absurde", () => {
    expect(() => effectiveSaleCoefficient(0, null)).toThrow(RangeError);
    expect(() => effectiveSaleCoefficient(null, 12)).toThrow(RangeError);
  });
});

describe("TVA selon le régime", () => {
  it("assujetti : refuse un taux hors 5,5 / 10 / 20 %", () => {
    const l = lines();
    l[0] = { ...l[0]!, vatRate: 0.07 };
    expect(() => computeQuote(quote(assujetti, l))).toThrow(RangeError);
  });
  it("franchise : les taux des lignes sont ignorés, TTC = HT", () => {
    const l = lines();
    l[0] = { ...l[0]!, vatRate: 0.07 };
    const r = computeQuote(quote(franchise, l));
    expect(r.totalTtcCents).toBe(r.totalHtCents);
    expect(r.vat).toEqual([]);
  });
});

describe("scénario compte de test (23 % MO, 16 % matériel, objectif 700 €/j)", () => {
  const mine: PricingSettings = { vatRegime: "franchise", laborChargesRate: 0.23, materialChargesRate: 0.16, targetMarginPerDayCents: 70000 };
  it("calcule la marge et alerte sous 700 €/j", () => {
    const r = computeQuote(quote(mine));
    // charges : 16 % × 1 600 € = 256 € ; 23 % × 940 € = 216,20 €
    expect(r.margin.materialChargesCents).toBe(25600);
    expect(r.margin.laborChargesCents).toBe(21620);
    expect(r.margin.netMarginCents).toBe(254000 - 106000 - 25600 - 21620);
    expect(r.margin.marginPerDayCents).toBe(50390);
    expect(r.alerts.map((a) => a.code)).toEqual(["margin_below_target"]);
  });
  it("l'arrondi ne descend jamais sous l'objectif : il monte", () => {
    const r = roundToPsychologicalPrice(quote(mine));
    expect(r.outcome).toBe("rounded_up");
    expect(r.result.totalTtcCents).toBe(259000);
  });
});

describe("seuils psychologiques", () => {
  it.each([
    [351200, 349000, 359000],
    [349100, 349000, 359000],
    [349000, 349000, 359000],
    [51200, 49900, 54900],
    [105000, 99900, 109000],
    [99950, 99900, 109000],
    [4000, null, 4900],
  ])("bornes de %i", (amount, lower, upper) => {
    expect(psychologicalBounds(amount)).toEqual({ lower, upper });
  });
  it("reconnaît un seuil psychologique", () => {
    expect(isPsychologicalPrice(349000)).toBe(true);
    expect(isPsychologicalPrice(49900)).toBe(true);
    expect(isPsychologicalPrice(351200)).toBe(false);
    expect(isPsychologicalPrice(349050)).toBe(false);
  });
});

describe("arrondi aux seuils psychologiques", () => {
  it("arrondit au seuil inférieur (2 540 € → 2 490 €) en ajustant la main d'œuvre", () => {
    const r = roundToPsychologicalPrice(quote(franchise));
    expect(r.outcome).toBe("rounded_down");
    expect(r.result.totalTtcCents).toBe(249000);
    const mo = r.lines.find((l) => l.id === "mo")!;
    expect(mo.quantity).toBe(1);
    expect(mo.unit).toBe("forfait");
    expect(mo.unitSaleCents).toBe(85000);
    expect(mo.designation).toContain("forfait 2 jour");
    // le matériel n'est pas touché
    expect(r.lines.find((l) => l.id === "ue")!.unitSaleCents).toBe(150000);
  });

  it("monte au seuil supérieur si le seuil inférieur passe sous l'objectif de marge", () => {
    const r = roundToPsychologicalPrice(quote({ ...franchise, targetMarginPerDayCents: 54000 }));
    expect(r.outcome).toBe("rounded_up");
    expect(r.result.totalTtcCents).toBe(259000);
    expect(r.result.alerts).toEqual([]);
  });

  it("devis déjà sous l'objectif : n'arrondit que vers le haut", () => {
    const r = roundToPsychologicalPrice(quote({ ...franchise, targetMarginPerDayCents: 100000 }));
    expect(r.outcome).toBe("rounded_up");
    expect(r.result.totalTtcCents).toBe(259000);
  });

  it("ne fait jamais passer une ligne sous son coût", () => {
    // sans main d'œuvre, l'ajustement porte sur la ligne la plus chère
    const l = lines().filter((x) => x.kind !== "labor");
    l[0] = { ...l[0]!, unitSaleCents: 114200 }; // à peine au-dessus du coût de revient
    const r = roundToPsychologicalPrice(quote(franchise, l, 1));
    expect(r.result.lines.some((x) => x.belowCost)).toBe(false);
    expect(r.outcome).toBe("rounded_up");
  });

  it("atteint le seuil exact au centime avec plusieurs taux de TVA", () => {
    const r = roundToPsychologicalPrice(quote(assujetti)); // 2 954 € TTC
    expect(r.outcome).toBe("rounded_down");
    expect(r.result.totalTtcCents).toBe(289000);
  });

  it("ne change rien si le total est déjà sur un seuil", () => {
    const first = roundToPsychologicalPrice(quote(franchise));
    const again = roundToPsychologicalPrice({ ...quote(franchise), lines: first.lines });
    expect(again.outcome).toBe("unchanged");
    expect(again.result.totalTtcCents).toBe(249000);
  });
});
