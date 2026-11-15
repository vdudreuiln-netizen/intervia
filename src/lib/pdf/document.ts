/**
 * Modèle du devis imprimé (indépendant du rendu PDF, donc testable).
 * RÈGLE ABSOLUE : aucune donnée de marge, de coût d'achat ou de charges ici.
 */
import type { QuoteDiscount, QuoteLineInput, QuoteResult } from "@/lib/pricing/engine";
import { formatIban } from "@/lib/company/validation";

export type Presentation = "particulier" | "detaille";

export interface DocCompany {
  legal_name: string;
  siret: string | null;
  address_line: string | null;
  postal_code: string | null;
  city: string | null;
  phone: string | null;
  email: string | null;
  insurer_name: string | null;
  insurance_policy: string | null;
  insurance_coverage: string | null;
  bank_holder: string | null;
  iban: string | null;
  bic: string | null;
  vat_regime: "franchise" | "assujetti";
  vat_number: string | null;
  payment_terms: string;
  mediator_name: string | null;
  mediator_address: string | null;
  mediator_website: string | null;
}

export interface ScheduleItem {
  label: string;
  rate: number;
}

export interface DocQuote {
  number: string;
  issueDate: string; // AAAA-MM-JJ
  validityDays: number;
  presentation: Presentation;
  signedOffPremises: boolean;
  earlyStart: boolean;
  urgentRepair: boolean;
  depositRate: number;
  schedule: ScheduleItem[] | null;
  discount: QuoteDiscount | null;
  client: { name: string; address: string | null; postalCode: string | null; city: string | null; phone: string | null; email: string | null };
  site: { address: string | null; postalCode: string | null; city: string | null };
}

export interface DocLine extends QuoteLineInput {
  wizardKey: string | null;
  origin: "wizard" | "manual";
}

export interface DocItem {
  designation: string;
  /** Détail sans prix (mode client particulier). */
  details?: string[];
  quantity?: string;
  unitPriceCents?: number;
  vatRate?: number | null; // null = taux multiples
  /** null = « Inclus ». */
  totalCents: number | null;
}

export interface QuoteDocument {
  number: string;
  issueDate: string;
  validUntil: string;
  /** Problèmes bloquants : affichés en bandeau rouge sur le PDF. */
  warnings: string[];
  company: { name: string; lines: string[] };
  client: string[];
  site: string[] | null;
  presentation: Presentation;
  showVat: boolean;
  items: DocItem[];
  totals: {
    grossHtCents: number | null; // avant remise (si remise)
    discount: { label: string; cents: number } | null;
    htCents: number;
    vat: { rate: number; baseCents: number; vatCents: number }[];
    ttcCents: number | null;
    vatMention: string | null;
    toPayCents: number;
  };
  payments: { label: string; cents: number }[];
  paymentNote: string | null;
  paymentTerms: string;
  legal: string[];
  signatureMention: string;
  earlyStartRequest: string | null;
  withdrawalForm: boolean;
  bank: { holder: string; iban: string; bic: string | null } | null;
}

const fr = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
};
export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
const pct = (r: number) => `${(Math.round(r * 1000) / 10).toLocaleString("fr-FR")} %`;
const qty = (l: QuoteLineInput) => {
  const unit = l.unit === "u" ? "" : l.unit === "jour" && l.quantity > 1 ? "jours" : l.unit;
  return `${l.quantity.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} ${unit}`.trim();
};
const stripIncluded = (s: string) => s.replace(/\s*\(inclus\)$/, "");

export function isCommissioning(l: DocLine): boolean {
  return !!l.wizardKey && (l.wizardKey.startsWith("mes:") || l.wizardKey.startsWith("cerfa:"));
}

/** Montants d'un échéancier : arrondis au centime, le reste sur la dernière échéance. */
export function splitPayments(totalCents: number, rates: number[]): number[] {
  const out = rates.map((r) => Math.round(totalCents * r));
  out[out.length - 1] = totalCents - out.slice(0, -1).reduce((a, b) => a + b, 0);
  return out;
}

export function validateSchedule(items: ScheduleItem[]): string | null {
  if (items.length < 2) return "Au moins 2 échéances";
  if (items.some((i) => !i.label.trim())) return "Chaque échéance a besoin d'un libellé";
  if (items.some((i) => !(i.rate > 0))) return "Chaque échéance doit être supérieure à 0 %";
  const sum = Math.round(items.reduce((a, i) => a + i.rate, 0) * 1000) / 1000;
  return sum === 1 ? null : `Le total des échéances fait ${pct(sum)} au lieu de 100 %`;
}

export function mediatorMissing(c: DocCompany): boolean {
  return !c.mediator_name?.trim() || !c.mediator_address?.trim() || !c.mediator_website?.trim();
}

/** Problèmes qui rendent le devis non conforme (bandeau rouge, envoi bloqué). */
export function documentWarnings(company: Pick<DocCompany, "mediator_name" | "mediator_address" | "mediator_website" | "siret" | "insurer_name" | "insurance_policy">): string[] {
  const w: string[] = [];
  if (mediatorMissing(company as DocCompany)) w.push("MÉDIATEUR MANQUANT : devis non conforme pour un particulier, ne pas l'envoyer (Paramètres › Médiateur)");
  if (!company.siret) w.push("SIRET manquant");
  if (!company.insurer_name || !company.insurance_policy) w.push("Assurance décennale manquante");
  return w;
}

export function buildQuoteDocument(company: DocCompany, q: DocQuote, lines: DocLine[], result: QuoteResult): QuoteDocument {
  const showVat = company.vat_regime === "assujetti";
  const warnings = documentWarnings(company);
  if (q.schedule) {
    const e = validateSchedule(q.schedule);
    if (e) warnings.push(`Échéancier incorrect : ${e}`);
  }

  // --- Lignes -----------------------------------------------------------------
  const priced = new Map(result.lines.map((l) => [l.id, l]));
  const total = (ls: DocLine[]) => ls.reduce((a, l) => a + (priced.get(l.id)?.totalSaleCents ?? 0), 0);
  const uniformVat = (ls: DocLine[]) => (showVat ? (new Set(ls.map((l) => l.vatRate)).size === 1 ? ls[0]!.vatRate : null) : undefined);
  const items: DocItem[] = [];

  if (q.presentation === "detaille") {
    for (const l of lines) {
      const t = priced.get(l.id)?.totalSaleCents ?? 0;
      items.push({
        designation: stripIncluded(l.designation),
        quantity: qty(l),
        unitPriceCents: t === 0 ? undefined : l.unitSaleCents,
        vatRate: showVat ? l.vatRate : undefined,
        totalCents: t === 0 ? null : t,
      });
    }
  } else {
    const supplies = lines.filter((l) => l.kind === "material" || l.kind === "accessory");
    const labor = lines.filter((l) => l.kind === "labor");
    const commissioning = lines.filter(isCommissioning);
    const services = lines.filter((l) => l.kind === "other" && !isCommissioning(l));
    const travel = lines.filter((l) => l.kind === "travel");
    if (supplies.length) {
      items.push({ designation: "Fourniture", details: supplies.map((l) => `${qty(l) || "1"} × ${l.designation}`), vatRate: uniformVat(supplies), totalCents: total(supplies) });
    }
    if (labor.length) {
      const days = labor.filter((l) => l.unit === "jour").reduce((a, l) => a + l.quantity, 0);
      items.push({
        designation: "Main d'œuvre : pose et raccordements",
        details: days > 0 ? [`${days.toLocaleString("fr-FR")} jour(s) de chantier`] : undefined,
        vatRate: uniformVat(labor),
        totalCents: total(labor),
      });
    }
    if (commissioning.length) {
      const t = total(commissioning);
      const details = ["Tirage au vide, test d'étanchéité à l'azote, contrôles de fonctionnement"];
      if (commissioning.some((l) => l.wizardKey!.startsWith("cerfa:"))) details.push("Fiche d'intervention fluides frigorigènes (CERFA 15497*04)");
      items.push({ designation: "Mise en service et contrôle d'étanchéité", details, vatRate: uniformVat(commissioning), totalCents: t === 0 ? null : t });
    }
    for (const l of services) {
      const t = total([l]);
      items.push({ designation: stripIncluded(l.designation), quantity: l.quantity !== 1 ? qty(l) : undefined, vatRate: showVat ? l.vatRate : undefined, totalCents: t === 0 ? null : t });
    }
    for (const l of travel) items.push({ designation: l.designation, vatRate: showVat ? l.vatRate : undefined, totalCents: total([l]) });
  }

  // --- Totaux et paiements ------------------------------------------------------
  const toPay = result.totalTtcCents;
  const discount =
    result.discountCents > 0
      ? { label: q.discount?.kind === "percent" ? `Remise commerciale (${pct(q.discount.value)})` : "Remise commerciale", cents: result.discountCents }
      : null;

  const offPremises = q.signedOffPremises && !q.urgentRepair;
  const payments: { label: string; cents: number }[] = [];
  if (q.schedule && !validateSchedule(q.schedule)) {
    splitPayments(toPay, q.schedule.map((s) => s.rate)).forEach((cents, i) => payments.push({ label: `${q.schedule![i]!.label} (${pct(q.schedule![i]!.rate)})`, cents }));
  } else if (q.depositRate > 0) {
    const [deposit, balance] = splitPayments(toPay, [q.depositRate, 1 - q.depositRate]);
    payments.push({ label: offPremises ? `Acompte de ${pct(q.depositRate)}, payable 7 jours après la signature` : `Acompte de ${pct(q.depositRate)} à la signature`, cents: deposit! });
    payments.push({ label: "Solde à la fin des travaux", cents: balance! });
  } else {
    payments.push({ label: "Paiement à la fin des travaux", cents: toPay });
  }
  const paymentNote = offPremises
    ? "Contrat conclu hors établissement : aucun paiement ne peut être exigé avant l'expiration d'un délai de 7 jours à compter de la signature (art. L221-10 du Code de la consommation)."
    : null;

  // --- Mentions légales ---------------------------------------------------------
  const validUntil = addDays(q.issueDate, q.validityDays);
  const legal: string[] = [
    `Devis gratuit, valable ${q.validityDays} jours, jusqu'au ${fr(validUntil)}. Prix fermes pendant cette durée.`,
  ];
  if (company.insurer_name && company.insurance_policy) {
    legal.push(
      `Assurance responsabilité civile décennale : ${company.insurer_name}, contrat n° ${company.insurance_policy}${company.insurance_coverage ? `, couverture géographique : ${company.insurance_coverage}` : ""}.`,
    );
  }
  if (!mediatorMissing(company)) {
    legal.push(
      `Médiation de la consommation : en cas de litige non résolu après réclamation écrite auprès de l'entreprise, le client peut recourir gratuitement au médiateur ${company.mediator_name}, ${company.mediator_address}, ${company.mediator_website} (art. L612-1 du Code de la consommation).`,
    );
  }
  if (q.urgentRepair) {
    legal.push(
      "Travaux d'entretien ou de réparation à réaliser en urgence au domicile du client et expressément sollicités par lui : pas de droit de rétractation, dans la limite des pièces de rechange et travaux strictement nécessaires pour répondre à l'urgence (art. L221-28, 8° du Code de la consommation).",
    );
  } else if (q.signedOffPremises) {
    legal.push(
      "Contrat conclu hors établissement : le client dispose d'un délai de 14 jours à compter de la signature pour exercer son droit de rétractation, sans avoir à motiver sa décision, au moyen du formulaire détachable joint ou de toute autre déclaration dénuée d'ambiguïté (art. L221-18 et suivants du Code de la consommation).",
    );
  }
  const earlyStartRequest =
    offPremises && q.earlyStart
      ? "Je demande expressément que les travaux commencent avant la fin du délai de rétractation de 14 jours. Si je me rétracte, je paierai un montant proportionnel aux travaux réalisés jusqu'à la communication de ma décision (art. L221-25). Je reconnais perdre mon droit de rétractation si les travaux sont entièrement exécutés avant la fin de ce délai (art. L221-28, 1°)."
      : null;

  const addr = (a: string | null, p: string | null, c: string | null) => [a, [p, c].filter(Boolean).join(" ")].filter((x) => x && x.trim()) as string[];
  const siteLines = addr(q.site.address, q.site.postalCode, q.site.city);
  const clientLines = [q.client.name, ...addr(q.client.address, q.client.postalCode, q.client.city), q.client.phone, q.client.email].filter(Boolean) as string[];
  const sameSite = siteLines.join("|") === addr(q.client.address, q.client.postalCode, q.client.city).join("|");

  return {
    number: q.number,
    issueDate: fr(q.issueDate),
    validUntil: fr(validUntil),
    warnings,
    company: {
      name: company.legal_name,
      lines: [
        ...addr(company.address_line, company.postal_code, company.city),
        [company.phone, company.email].filter(Boolean).join(" · "),
        company.siret ? `SIRET ${company.siret.replace(/(\d{3})(\d{3})(\d{3})(\d{5})/, "$1 $2 $3 $4")}` : "",
        showVat && company.vat_number ? `N° TVA intracommunautaire ${company.vat_number}` : "",
      ].filter(Boolean),
    },
    client: clientLines,
    site: siteLines.length && !sameSite ? siteLines : null,
    presentation: q.presentation,
    showVat,
    items,
    totals: {
      grossHtCents: discount ? result.grossHtCents : null,
      discount,
      htCents: result.totalHtCents,
      vat: result.vat.map((v) => ({ rate: v.rate, baseCents: v.baseCents, vatCents: v.vatCents })),
      ttcCents: showVat ? result.totalTtcCents : null,
      vatMention: result.vatMention,
      toPayCents: toPay,
    },
    payments,
    paymentNote,
    paymentTerms: company.payment_terms,
    legal,
    signatureMention: "Bon pour accord. Devis reçu avant l'exécution des travaux.",
    earlyStartRequest,
    withdrawalForm: offPremises,
    bank: company.iban ? { holder: company.bank_holder ?? company.legal_name, iban: formatIban(company.iban), bic: company.bic } : null,
  };
}

/** Texte du formulaire type de rétractation (annexe à l'article R221-1 du Code de la consommation). */
export const WITHDRAWAL_FORM_TEXT = [
  "Veuillez compléter et renvoyer le présent formulaire uniquement si vous souhaitez vous rétracter du contrat.",
  "Je/Nous (*) vous notifie/notifions (*) par la présente ma/notre (*) rétractation du contrat portant sur la prestation de services ci-dessous :",
];
