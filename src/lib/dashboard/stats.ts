/**
 * Indicateurs du tableau de bord. Les mois sont ceux de Paris (un devis
 * accepté le 31 à 23 h 30 compte pour le mois en cours, pas le suivant).
 */

export type QuoteStatus = "brouillon" | "envoye" | "accepte" | "refuse";

export interface QuoteSummary {
  id: string;
  status: QuoteStatus;
  totalHtCents: number;
  netMarginCents: number;
  createdAt: string;
  sentAt: string | null;
  decidedAt: string | null;
  lastFollowUpAt: string | null;
}

/** Avenant accepté par le client (le devis signé n'est jamais modifié). */
export interface AmendmentSummary {
  quoteId: string;
  totalHtCents: number;
  /** Effet sur la marge nette (0 si non visible). */
  marginCents: number;
  decidedAt: string;
}

const monthFmt = new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit" });

/** « 2026-11 » pour une date ISO, à l'heure de Paris. */
export function parisMonth(iso: string | Date): string {
  return monthFmt.format(typeof iso === "string" ? new Date(iso) : iso).slice(0, 7);
}

export function previousMonth(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" });
}

export interface MonthStats {
  month: string;
  /** CA signé HT = devis acceptés dans le mois + avenants acceptés dans le mois. */
  signedHtCents: number;
  /** Détail : montant initial des devis acceptés dans le mois. */
  initialHtCents: number;
  /** Détail : avenants acceptés dans le mois. */
  amendmentsHtCents: number;
  amendmentsCount: number;
  signedMarginCents: number;
  acceptedCount: number;
  /** Devis envoyés dans le mois (ou acceptés sans avoir été marqués envoyés). */
  sentCount: number;
  /** Parmi les devis envoyés dans le mois, part acceptée (à ce jour). null si aucun envoi. */
  conversionRate: number | null;
}

export function monthStats(quotes: QuoteSummary[], month: string, amendments: AmendmentSummary[] = []): MonthStats {
  const am = amendments.filter((a) => parisMonth(a.decidedAt) === month);
  const amendmentsHtCents = am.reduce((s, a) => s + a.totalHtCents, 0);
  const accepted = quotes.filter((q) => q.status === "accepte" && q.decidedAt && parisMonth(q.decidedAt) === month);
  const sentAt = (q: QuoteSummary) => q.sentAt ?? (q.status === "accepte" || q.status === "refuse" ? q.decidedAt : null);
  const sent = quotes.filter((q) => {
    const s = sentAt(q);
    return s !== null && q.status !== "brouillon" && parisMonth(s) === month;
  });
  return {
    month,
    signedHtCents: accepted.reduce((a, q) => a + q.totalHtCents, 0) + amendmentsHtCents,
    initialHtCents: accepted.reduce((a, q) => a + q.totalHtCents, 0),
    amendmentsHtCents,
    amendmentsCount: am.length,
    signedMarginCents: accepted.reduce((a, q) => a + q.netMarginCents, 0) + am.reduce((s, a) => s + a.marginCents, 0),
    acceptedCount: accepted.length,
    sentCount: sent.length,
    conversionRate: sent.length ? sent.filter((q) => q.status === "accepte").length / sent.length : null,
  };
}

/** Variation relative par rapport au mois précédent (null si le mois précédent est à 0). */
export function change(current: number, previous: number): number | null {
  return previous === 0 ? null : (current - previous) / previous;
}

export interface Dashboard {
  current: MonthStats;
  previous: MonthStats;
  changes: { signedHt: number | null; signedMargin: number | null; conversionPoints: number | null };
  toFollowUp: string[];
}

/** Devis envoyés sans réponse depuis `days` jours (depuis l'envoi ou la dernière relance). */
export function needsFollowUp(q: QuoteSummary, days: number, now: Date): boolean {
  if (q.status !== "envoye" || !q.sentAt) return false;
  const last = new Date(q.lastFollowUpAt && q.lastFollowUpAt > q.sentAt ? q.lastFollowUpAt : q.sentAt);
  return now.getTime() - last.getTime() >= days * 86_400_000;
}

export function dashboard(quotes: QuoteSummary[], now: Date, followUpDays: number, amendments: AmendmentSummary[] = []): Dashboard {
  const month = parisMonth(now);
  const current = monthStats(quotes, month, amendments);
  const previous = monthStats(quotes, previousMonth(month), amendments);
  return {
    current,
    previous,
    changes: {
      signedHt: change(current.signedHtCents, previous.signedHtCents),
      signedMargin: change(current.signedMarginCents, previous.signedMarginCents),
      conversionPoints: current.conversionRate !== null && previous.conversionRate !== null ? current.conversionRate - previous.conversionRate : null,
    },
    toFollowUp: quotes.filter((q) => needsFollowUp(q, followUpDays, now)).map((q) => q.id),
  };
}

/** Message de relance prêt à envoyer. */
export function followUpMessage(p: { clientName: string; number: string; date: string; amount: string; companyName: string; phone: string | null }): string {
  const hello = p.clientName.trim() ? `Bonjour ${p.clientName.trim()},` : "Bonjour,";
  return [
    hello,
    "",
    `Je me permets de revenir vers vous au sujet du devis ${p.number} du ${p.date} pour l'installation de votre climatisation (${p.amount}).`,
    "Avez-vous pu en prendre connaissance ? Je reste à votre disposition pour toute question ou pour l'ajuster si besoin.",
    "",
    `Bien cordialement,`,
    p.companyName + (p.phone ? ` – ${p.phone}` : ""),
  ].join("\n");
}
