import { describe, expect, it } from "vitest";
import { change, dashboard, followUpMessage, monthLabel, monthStats, needsFollowUp, parisMonth, previousMonth, type QuoteSummary } from "./stats";

let n = 0;
const q = (status: QuoteSummary["status"], ht: number, margin: number, sentAt: string | null, decidedAt: string | null = null, lastFollowUpAt: string | null = null): QuoteSummary => ({
  id: `q${n++}`,
  status,
  totalHtCents: ht,
  netMarginCents: margin,
  createdAt: "2026-10-01T08:00:00Z",
  sentAt,
  decidedAt,
  lastFollowUpAt,
});

describe("mois à l'heure de Paris", () => {
  it("le 30 novembre à 23 h 30 (Paris) compte en novembre", () => {
    expect(parisMonth("2026-11-30T22:30:00Z")).toBe("2026-11");
    expect(parisMonth("2026-11-30T23:30:00Z")).toBe("2026-12"); // minuit et demi à Paris
  });
  it("mois précédent et libellé", () => {
    expect(previousMonth("2026-01")).toBe("2025-12");
    expect(previousMonth("2026-11")).toBe("2026-10");
    expect(monthLabel("2026-11")).toBe("novembre 2026");
  });
});

describe("indicateurs du mois", () => {
  const quotes = [
    q("accepte", 500000, 150000, "2026-11-02T10:00:00Z", "2026-11-10T10:00:00Z"),
    q("accepte", 300000, 90000, "2026-10-20T10:00:00Z", "2026-11-03T10:00:00Z"), // envoyé en octobre, signé en novembre
    q("refuse", 400000, 100000, "2026-11-05T10:00:00Z", "2026-11-12T10:00:00Z"),
    q("envoye", 250000, 70000, "2026-11-08T10:00:00Z"),
    q("brouillon", 999900, 999900, null),
    q("accepte", 200000, 50000, "2026-10-01T10:00:00Z", "2026-10-15T10:00:00Z"),
    q("envoye", 100000, 20000, "2026-10-25T10:00:00Z"),
  ];
  it("CA signé HT et marge à la date d'acceptation", () => {
    const s = monthStats(quotes, "2026-11");
    expect(s.signedHtCents).toBe(800000);
    expect(s.signedMarginCents).toBe(240000);
    expect(s.acceptedCount).toBe(2);
  });
  it("taux de transformation : acceptés parmi les devis envoyés dans le mois", () => {
    const s = monthStats(quotes, "2026-11");
    expect(s.sentCount).toBe(3); // 1 accepté, 1 refusé, 1 en attente
    expect(s.conversionRate).toBeCloseTo(1 / 3);
    expect(monthStats(quotes, "2026-10").conversionRate).toBeCloseTo(2 / 3);
  });
  it("comparaison avec le mois précédent", () => {
    const d = dashboard(quotes, new Date("2026-11-14T12:00:00Z"), 7);
    expect(d.previous.signedHtCents).toBe(200000);
    expect(d.changes.signedHt).toBe(3); // 800 000 vs 200 000 : +300 %
    expect(d.changes.conversionPoints).toBeCloseTo(1 / 3 - 2 / 3);
    expect(change(100, 0)).toBeNull();
  });
  it("avenants acceptés : comptés dans le CA du mois de leur acceptation, avec le détail", () => {
    const amendments = [
      { quoteId: "x", totalHtCents: 15600, marginCents: 8000, decidedAt: "2026-11-20T10:00:00Z" },
      { quoteId: "y", totalHtCents: 40000, marginCents: 20000, decidedAt: "2026-10-28T10:00:00Z" }, // avenant d'octobre
    ];
    const s = monthStats(quotes, "2026-11", amendments);
    expect(s).toMatchObject({ initialHtCents: 800000, amendmentsHtCents: 15600, amendmentsCount: 1, signedHtCents: 815600, signedMarginCents: 248000 });
    const d = dashboard(quotes, new Date("2026-11-14T12:00:00Z"), 7, amendments);
    expect(d.previous.signedHtCents).toBe(240000);
  });
  it("devis accepté sans avoir été marqué envoyé : compté comme envoyé", () => {
    expect(monthStats([q("accepte", 1, 1, null, "2026-11-03T10:00:00Z")], "2026-11").conversionRate).toBe(1);
  });
});

describe("relances", () => {
  const now = new Date("2026-11-14T12:00:00Z");
  it("envoyé depuis 7 jours sans réponse", () => {
    expect(needsFollowUp(q("envoye", 1, 1, "2026-11-07T11:00:00Z"), 7, now)).toBe(true);
    expect(needsFollowUp(q("envoye", 1, 1, "2026-11-08T13:00:00Z"), 7, now)).toBe(false);
  });
  it("le délai repart de la dernière relance", () => {
    expect(needsFollowUp(q("envoye", 1, 1, "2026-10-01T10:00:00Z", null, "2026-11-12T10:00:00Z"), 7, now)).toBe(false);
  });
  it("jamais pour un devis accepté, refusé ou brouillon", () => {
    expect(needsFollowUp(q("accepte", 1, 1, "2026-10-01T10:00:00Z", "2026-10-02T10:00:00Z"), 7, now)).toBe(false);
  });
  it("message type", () => {
    const m = followUpMessage({ clientName: "M. Martin", number: "D-2026-001", date: "14/11/2026", amount: "5 467 € HT", companyName: "Clim Atlantique", phone: "06 12 34 56 78" });
    expect(m.startsWith("Bonjour M. Martin,")).toBe(true);
    expect(m).toContain("D-2026-001 du 14/11/2026");
    expect(m).toContain("Clim Atlantique – 06 12 34 56 78");
  });
});
