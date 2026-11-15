import { describe, expect, it } from "vitest";
import path from "node:path";
import { readSheet } from "read-excel-file/node";
import { buildPlan, detectHeaderRow, guessMapping, normalizeMaterialRows, projectRows, validateMapping, type Cell } from "./import";

// Tarif « fournisseur » réaliste : titre au-dessus du tableau, intitulés non standard,
// nombres Excel, texte « 3,5 kW », remise au format pourcentage, ligne invalide.
const FIXTURE = path.join(__dirname, "__fixtures__", "tarif-distrib-sud.xlsx");

describe("import d'un vrai fichier Excel fournisseur", () => {
  it("lit, détecte l'en-tête, mappe et planifie", async () => {
    const table = (await readSheet(FIXTURE)) as Cell[][];
    const header = detectHeaderRow(table, "materiel");
    expect(header).toBe(3);
    const mapping = guessMapping(table[header]!, "materiel");
    expect(validateMapping(mapping, "materiel", {})).toEqual([]);

    const { rows, errors } = normalizeMaterialRows(projectRows(table, header, mapping), {});
    expect(rows.map((r) => [r.reference, r.type, r.cooling_kw, r.public_price_cents, r.discount_rate])).toEqual([
      ["ARC-UE35", "ue_mono", 3.5, 117720, null],
      ["ARC-MU35", "ui_murale", 3.5, 55000, 0.3],
      ["BO-GA50", "ui_gainable", 5, 145000, 0.38],
    ]);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.line).toBe(8);

    const plan = buildPlan(
      "materiel",
      rows,
      [
        {
          id: "p1",
          brand: "Exemple – Arctica",
          reference: "ARC-UE35",
          label: "Arctica UE35",
          offer: {
            public_price_cents: 109000,
            net_price_cents: null,
            discount_rate: 0.42,
            match_status: "certain",
          },
        },
      ],
      ["Exemple – Arctica"],
      errors,
    );
    expect(plan.summary).toMatchObject({
      newItems: 2,
      priceChanges: 1,
      bigIncreases: 1,
      errors: 1,
    });
    expect(plan.updates[0]).toEqual({
      id: "p1",
      cooling_kw: 3.5,
      heating_kw: 4,
    });
    expect(plan.offers[0]).toMatchObject({
      item_id: "p1",
      public_price_cents: 117720,
      match_status: "certain",
    });
    expect("discount_rate" in plan.offers[0]!).toBe(false);
    expect(plan.brandsToCreate).toEqual([{ name: "Borée" }]);
  });
});
