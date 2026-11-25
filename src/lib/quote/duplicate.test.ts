import { describe, expect, it } from "vitest";
import { priceNotices, remapIds } from "./duplicate";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

describe("copie d'un devis", () => {
  it("renumérote les pièces partout dans l'état de l'assistant", () => {
    const wizard: { selection: { systems: { indoors: { key: string; roomIds: string[] }[] }[] }; metre: { linkM: Record<string, number>; qty: Record<string, number> }; edits: { overrides: Record<string, { unitSaleCents: number }>; removed: string[] } } = {
      selection: { systems: [{ indoors: [{ key: `i-${A}`, roomIds: [A] }] }] },
      metre: { linkM: { [`i-${A}`]: 12 }, qty: { [`goulotte:i-${A}`]: 8 } },
      edits: { overrides: { [`liaison:i-${A}`]: { unitSaleCents: 2000 } }, removed: [`pompe:i-${A}`] },
    };
    const out = remapIds(wizard, new Map([[A, B]]));
    expect(JSON.stringify(out)).not.toContain(A);
    expect(out.metre.linkM[`i-${B}`]).toBe(12);
    expect(out.edits.removed).toEqual([`pompe:i-${B}`]);
    expect(out.selection.systems[0]!.indoors[0]!.roomIds).toEqual([B]);
  });

  it("prix mis à jour sur les lignes non retouchées", () => {
    const n = priceNotices(
      [{ wizardKey: "eq:s1", designation: "UE", unitSaleCents: 109000, unitPurchaseCents: 70850 }],
      [{ wizardKey: "eq:s1", designation: "UE", unitSaleCents: 117700, unitPurchaseCents: 76505 }],
      undefined,
    );
    expect(n).toEqual([{ designation: "UE", kind: "updated", fromCents: 109000, toCents: 117700 }]);
  });

  it("retouche conservée mais prix d'achat changé : avertissement", () => {
    const n = priceNotices(
      [{ wizardKey: "liaison:i1", designation: "Liaison", unitSaleCents: 2000, unitPurchaseCents: 840 }],
      [{ wizardKey: "liaison:i1", designation: "Liaison", unitSaleCents: 2000, unitPurchaseCents: 960 }],
      { overrides: { "liaison:i1": { unitSaleCents: 2000 } }, removed: [] },
    );
    // aucun prix d'achat stocké : l'état du devis est lisible par les techniciens
    expect(n).toEqual([{ designation: "Liaison", kind: "override_kept", keptSaleCents: 2000 }]);
  });

  it("rien à signaler si les prix n'ont pas bougé", () => {
    const l = { wizardKey: "mo", designation: "MO", unitSaleCents: 45000, unitPurchaseCents: 0 };
    expect(priceNotices([l], [l], undefined)).toEqual([]);
  });
});
