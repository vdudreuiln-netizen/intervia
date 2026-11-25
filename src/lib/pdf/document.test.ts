import { describe, expect, it } from "vitest";
import { computeQuote, type PricingSettings } from "@/lib/pricing/engine";
import { addDays, buildQuoteDocument, splitPayments, validateSchedule, type DocCompany, type DocLine, type DocQuote } from "./document";

const company: DocCompany = {
  legal_name: "Clim Atlantique EI",
  siret: "73282932000074",
  address_line: "5 quai des Chartrons",
  postal_code: "33000",
  city: "Bordeaux",
  phone: "06 12 34 56 78",
  email: "contact@clim.fr",
  insurer_name: "Assur BTP",
  insurance_policy: "DEC-123",
  insurance_coverage: "France métropolitaine",
  bank_holder: "Clim Atlantique",
  iban: "FR7630006000011234567890189",
  bic: "AGRIFRPP",
  vat_regime: "franchise",
  vat_number: null,
  payment_terms: "Paiement par virement ou chèque.",
  mediator_name: "Médiateur Exemple",
  mediator_address: "1 rue de la Paix, 75002 Paris",
  mediator_website: "www.mediateur-exemple.fr",
};
const quote: DocQuote = {
  number: "D-2026-001",
  issueDate: "2026-11-14",
  validityDays: 30,
  presentation: "particulier",
  signedOffPremises: true,
  earlyStart: false,
  urgentRepair: false,
  depositRate: 0.3,
  schedule: null,
  discount: null,
  client: { name: "M. Martin", address: "3 rue des Lilas", postalCode: "33700", city: "Mérignac", phone: null, email: null },
  site: { address: "3 rue des Lilas", postalCode: "33700", city: "Mérignac" },
};
const L = (id: string, kind: DocLine["kind"], designation: string, quantity: number, unit: string, sale: number, wizardKey: string | null = id, purchase = 0): DocLine => ({
  id,
  kind,
  designation,
  quantity,
  unit,
  unitPurchaseCents: purchase,
  unitSaleCents: sale,
  vatRate: 0,
  wizardKey,
  origin: wizardKey ? "wizard" : "manual",
});
const lines: DocLine[] = [
  L("eq:s1", "material", "Unité extérieure Boréal UE35", 1, "u", 109000, "eq:s1", 70000),
  L("eq:i1", "material", "Murale Boréal MU35 – Salon", 1, "u", 54000, "eq:i1", 35000),
  L("liaison:i1", "accessory", "Liaison frigorifique 1/4 - 3/8", 5, "m", 1680, "liaison:i1", 840),
  L("mes:s1", "other", "Mise en service : tirage au vide, test d'étanchéité à l'azote, contrôles (inclus)", 1, "forfait", 0),
  L("cerfa:s1", "other", "Fiche d'intervention fluides frigorigènes (CERFA 15497*04) (inclus)", 1, "forfait", 0),
  L("mo", "labor", "Main d'œuvre : pose et raccordements", 1.5, "jour", 45000),
  L("dep", "travel", "Frais de déplacement (2 j × 30,00 €)", 1, "forfait", 6000),
  L("free1", "other", "Carottage mur béton Ø 60", 1, "u", 12000, null),
];
const S: PricingSettings = { vatRegime: "franchise", laborChargesRate: 0.23, materialChargesRate: 0.16, targetMarginPerDayCents: 0 };
const doc = (c = company, q = quote, ls = lines) => buildQuoteDocument(c, q, ls, computeQuote({ lines: ls, laborDays: 1.5, settings: S, discount: q.discount }));

describe("devis « client particulier »", () => {
  const d = doc();
  it("Fourniture regroupée (matériel + accessoires) avec le détail sans prix", () => {
    const f = d.items[0]!;
    expect(f.designation).toBe("Fourniture");
    expect(f.totalCents).toBe(109000 + 54000 + 8400);
    expect(f.details).toEqual(["1 × Unité extérieure Boréal UE35", "1 × Murale Boréal MU35 – Salon", "5 m × Liaison frigorifique 1/4 - 3/8"]);
  });
  it("ordre : fourniture, main d'œuvre, mise en service, prestations libres, déplacement", () => {
    expect(d.items.map((i) => i.designation)).toEqual(["Fourniture", "Main d'œuvre : pose et raccordements", "Mise en service et contrôle d'étanchéité", "Carottage mur béton Ø 60", "Frais de déplacement (2 j × 30,00 €)"]);
  });
  it("mise en service à part, avec la fiche fluides, « Inclus » si 0 €", () => {
    const m = d.items[2]!;
    expect(m.totalCents).toBeNull();
    expect(m.details).toContain("Fiche d'intervention fluides frigorigènes (CERFA 15497*04)");
  });
  it("aucune marge, aucun prix d'achat dans le document", () => {
    const json = JSON.stringify(d);
    expect(json).not.toMatch(/marge|achat|purchase|margin|charges/i);
    expect(json).not.toContain("70000");
  });
});

describe("devis « détaillé »", () => {
  it("chaque article sur sa ligne avec son prix", () => {
    const d = doc(company, { ...quote, presentation: "detaille" });
    expect(d.items).toHaveLength(lines.length);
    expect(d.items[2]).toMatchObject({ designation: "Liaison frigorifique 1/4 - 3/8", quantity: "5 m", unitPriceCents: 1680, totalCents: 8400 });
    expect(d.items[3]).toMatchObject({ designation: "Mise en service : tirage au vide, test d'étanchéité à l'azote, contrôles", totalCents: null });
  });
});

describe("totaux, remise et TVA", () => {
  it("franchise : mention art. 293 B, pas de TTC", () => {
    const d = doc();
    expect(d.totals.vatMention).toBe("TVA non applicable, art. 293 B du CGI");
    expect(d.totals.ttcCents).toBeNull();
    expect(d.showVat).toBe(false);
  });
  it("remise commerciale visible par le client", () => {
    const d = doc(company, { ...quote, discount: { kind: "percent", value: 0.05 } });
    expect(d.totals.discount).toMatchObject({ label: "Remise commerciale (5 %)" });
    expect(d.totals.grossHtCents! - d.totals.discount!.cents).toBe(d.totals.htCents);
  });
  it("assujetti : TVA détaillée et n° de TVA de l'entreprise", () => {
    const ls = lines.map((l) => ({ ...l, vatRate: 0.1 }));
    const c = { ...company, vat_regime: "assujetti" as const, vat_number: "FR44732829320" };
    const d = buildQuoteDocument(c, quote, ls, computeQuote({ lines: ls, laborDays: 1.5, settings: { ...S, vatRegime: "assujetti" } }));
    expect(d.totals.ttcCents).toBe(d.totals.htCents + d.totals.vat[0]!.vatCents);
    expect(d.company.lines).toContain("N° TVA intracommunautaire FR44732829320");
    expect(d.items[0]!.vatRate).toBe(0.1);
  });
});

describe("acompte, solde et échéancier", () => {
  it("signé chez le client : acompte payable 7 jours après la signature (art. L221-10)", () => {
    const d = doc();
    expect(d.payments[0]!.label).toBe("Acompte de 30 %, payable 7 jours après la signature");
    expect(d.payments[1]!.label).toBe("Solde à la fin des travaux");
    expect(d.payments[0]!.cents + d.payments[1]!.cents).toBe(d.totals.toPayCents);
    expect(d.paymentNote).toContain("L221-10");
  });
  it("signé dans les locaux de l'entreprise : acompte à la signature", () => {
    const d = doc(company, { ...quote, signedOffPremises: false });
    expect(d.payments[0]!.label).toBe("Acompte de 30 % à la signature");
    expect(d.paymentNote).toBeNull();
  });
  it("échéancier en plusieurs fois", () => {
    const schedule = [
      { label: "À la signature", rate: 0.3 },
      { label: "À la livraison du matériel", rate: 0.4 },
      { label: "À la fin des travaux", rate: 0.3 },
    ];
    const d = doc(company, { ...quote, signedOffPremises: false, schedule });
    expect(d.payments.map((p) => p.label)).toEqual(["À la signature (30 %)", "À la livraison du matériel (40 %)", "À la fin des travaux (30 %)"]);
    expect(d.payments.reduce((a, p) => a + p.cents, 0)).toBe(d.totals.toPayCents);
  });
  it("répartition au centime, reste sur la dernière échéance", () => {
    expect(splitPayments(100001, [0.3, 0.7])).toEqual([30000, 70001]);
  });
  it("échéancier invalide : signalé", () => {
    expect(validateSchedule([{ label: "A", rate: 0.3 }, { label: "B", rate: 0.6 }])).toContain("90 %");
    expect(validateSchedule([{ label: "A", rate: 1 }])).toBe("Au moins 2 échéances");
    expect(doc(company, { ...quote, schedule: [{ label: "A", rate: 0.5 }, { label: "B", rate: 0.4 }] }).warnings.some((w) => w.startsWith("Échéancier"))).toBe(true);
  });
});

describe("mentions légales et rétractation", () => {
  it("validité, décennale, médiateur", () => {
    const d = doc();
    expect(addDays("2026-11-14", 30)).toBe("2026-12-14");
    expect(d.validUntil).toBe("14/12/2026");
    expect(d.legal.join(" ")).toContain("Assur BTP, contrat n° DEC-123, couverture géographique : France métropolitaine");
    expect(d.legal.join(" ")).toContain("Médiateur Exemple");
    expect(d.warnings).toEqual([]);
  });
  it("médiateur manquant : bandeau rouge", () => {
    const d = doc({ ...company, mediator_website: null });
    expect(d.warnings[0]).toContain("MÉDIATEUR MANQUANT");
    expect(d.legal.join(" ")).not.toContain("Médiation");
  });
  it("signé chez le client : information 14 jours + formulaire détachable", () => {
    const d = doc();
    expect(d.legal.some((l) => l.includes("14 jours"))).toBe(true);
    expect(d.withdrawalForm).toBe(true);
    expect(d.earlyStartRequest).toBeNull();
    expect(d.signatureMention).toContain("Devis reçu avant l'exécution des travaux");
  });
  it("démarrage avant la fin du délai : demande expresse du client (L221-25)", () => {
    expect(doc(company, { ...quote, earlyStart: true }).earlyStartRequest).toContain("L221-25");
  });
  it("dépannage urgent : pas de rétractation, pas de formulaire, acompte immédiat possible", () => {
    const d = doc(company, { ...quote, urgentRepair: true, earlyStart: true });
    expect(d.withdrawalForm).toBe(false);
    expect(d.earlyStartRequest).toBeNull();
    expect(d.legal.some((l) => l.includes("L221-28, 8°"))).toBe(true);
    expect(d.payments[0]!.label).toBe("Acompte de 30 % à la signature");
    expect(d.paymentNote).toBeNull();
  });
  it("RIB en bas de page, IBAN par blocs", () => {
    expect(doc().bank).toEqual({ holder: "Clim Atlantique", iban: "FR76 3000 6000 0112 3456 7890 189", bic: "AGRIFRPP" });
  });
  it("adresse du chantier affichée seulement si différente", () => {
    expect(doc().site).toBeNull();
    expect(doc(company, { ...quote, site: { address: "8 allée des Pins", postalCode: "33600", city: "Pessac" } }).site).toEqual(["8 allée des Pins", "33600 Pessac"]);
  });
});
