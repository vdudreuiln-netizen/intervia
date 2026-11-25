/**
 * Fiche d'intervention fluides frigorigènes (PUR, testé).
 *
 * France : formulaire officiel CERFA n° 15497*04 (article R. 543-82 du code de
 * l'environnement, arrêté du 29 février 2016 modifié), pré-rempli cadre par cadre.
 * Autres pays : fiche générique portant les mêmes données (règlement (UE) 2024/573).
 *
 * Fréquence des contrôles d'étanchéité (HFC, article 5 du règlement (UE) 2024/573) :
 *   < 5 t éq. CO2 : aucun contrôle périodique
 *   5 à < 50 t    : 12 mois (24 mois avec détection permanente des fuites)
 *   50 à < 500 t  : 6 mois (12 mois avec détection permanente)
 *   ≥ 500 t       : 3 mois (6 mois avec détection permanente)
 */
import type { Equipment, Metre } from "@/lib/quote/types";
import { linkLength } from "@/lib/quote/lines";
import { equipmentTags } from "@/lib/plans/layout";
import type { UnitTech } from "@/lib/plans/rules";

// ---------------------------------------------------------------------------
// Fluides : PRG et classement transport / déchets
// ---------------------------------------------------------------------------

/** PRG (potentiel de réchauffement planétaire) à 100 ans, valeurs du 4e rapport du GIEC reprises par la réglementation F-Gaz. */
export const PRG: Record<string, number> = {
  R32: 675,
  R410A: 2088,
  R407C: 1774,
  R134A: 1430,
  R404A: 3922,
  R452B: 698,
  R454B: 466,
  R454C: 148,
  R513A: 631,
  R448A: 1387,
  R449A: 1397,
  R1234YF: 4,
  R1234ZE: 7,
  R290: 3,
  R600A: 3,
  R744: 1,
};

/** Fluides inflammables (A2L, A3) : rubrique déchets 16 05 04*. */
const FLAMMABLE = new Set(["R32", "R452B", "R454B", "R454C", "R1234YF", "R1234ZE", "R290", "R600A"]);
/** Fluides de la famille HFC et mélanges HFC/HFO (seuils de contrôle en t éq. CO2). */
const HFC = new Set(["R32", "R410A", "R407C", "R134A", "R404A", "R452B", "R454B", "R454C", "R513A", "R448A", "R449A"]);
/** HFO purs (seuils de contrôle en kg sur le CERFA : 1 / 10 / 100 kg). */
const HFO = new Set(["R1234YF", "R1234ZE"]);

export const normalizeFluid = (f: string | null | undefined) => (f ?? "").toUpperCase().replace(/[\s-]/g, "");
export const fluidLabel = (f: string) => {
  const n = normalizeFluid(f);
  return n ? `R-${n.slice(1)}` : "";
};

export function prgOf(fluid: string): number | null {
  return PRG[normalizeFluid(fluid)] ?? null;
}

export function isFlammable(fluid: string): boolean {
  return FLAMMABLE.has(normalizeFluid(fluid));
}

/** Tonnage équivalent CO2 = kg × PRG ÷ 1000 (arrondi à 0,01 t). */
export function teqCo2(chargeKg: number, prg: number): number {
  return Math.round(((chargeKg * prg) / 1000) * 100) / 100;
}

/**
 * Code ONU spécifique par fluide (cadre [12], ligne « Autres fluides frigorigènes… »).
 * Fluide absent de la table : case par défaut UN 3161 (inflammable) ou UN 1078 (non inflammable).
 */
export const UN_BY_FLUID: Record<string, string> = {
  R32: "UN 3252, déchet difluorométhane (gaz réfrigérant R 32), 2.1",
  R410A: "UN 3163, déchet gaz liquéfié NSA (gaz réfrigérant R 410A), 2.2",
  R407C: "UN 3340, déchet gaz réfrigérant R 407C, 2.2",
  R404A: "UN 3337, déchet gaz réfrigérant R 404A, 2.2",
  R134A: "UN 3159, déchet 1,1,1,2-tétrafluoroéthane (gaz réfrigérant R 134a), 2.2",
  R290: "UN 1978, déchet propane (gaz réfrigérant R 290), 2.1",
  R600A: "UN 1969, déchet isobutane (gaz réfrigérant R 600a), 2.1",
};

export interface Adr {
  flammable: boolean;
  /** Case cochée au cadre [12]. */
  box: "UN1078" | "UN3161" | "autre_non_inflammable" | "autre_inflammable";
  /** Texte de la ligne « Autres fluides frigorigènes… » (vide pour la case par défaut). */
  other: string;
  un: string;
  designation: string;
  waste: string;
}

/** Cadre [12] : rubrique déchets selon l'inflammabilité, code ONU spécifique si connu. */
export function adrOf(fluid: string): Adr {
  const flammable = isFlammable(fluid);
  const specific = UN_BY_FLUID[normalizeFluid(fluid)];
  const waste = flammable ? "16 05 04*" : "14 06 01*";
  if (specific) {
    return { flammable, box: flammable ? "autre_inflammable" : "autre_non_inflammable", other: specific, un: specific.split(",")[0]!, designation: specific.split(",").slice(1).join(",").trim(), waste };
  }
  return flammable
    ? { flammable, box: "UN3161", other: "", un: "UN 3161", designation: "Déchet gaz liquéfié inflammable NSA, 2.1 (B/D)", waste }
    : { flammable, box: "UN1078", other: "", un: "UN 1078", designation: "Déchet gaz frigorifique NSA (gaz réfrigérant, NSA), 2.2 (C/E)", waste };
}

/**
 * Cadres [7] à [9] : périodicité du contrôle d'étanchéité, en mois ; null = aucun
 * contrôle périodique (jamais exigé sous 5 t éq. CO2).
 */
/** HFO : mêmes fréquences, seuils en kg de fluide (1 / 10 / 100 kg), selon le CERFA 15497*04. */
export function leakCheckMonthsHfo(kg: number, permanentDetection: boolean): number | null {
  return leakCheckMonths(kg * 5, permanentDetection);
}

export function leakCheckMonths(teq: number, permanentDetection: boolean): number | null {
  if (!(teq >= 5)) return null;
  if (teq < 50) return permanentDetection ? 24 : 12;
  if (teq < 500) return permanentDetection ? 12 : 6;
  return permanentDetection ? 6 : 3;
}

// ---------------------------------------------------------------------------
// Saisie (enregistrée dans site_jobs.fluid_form)
// ---------------------------------------------------------------------------

export const NATURES = {
  assemblage: "Assemblage de l'équipement",
  mise_en_service: "Mise en service de l'équipement",
  modification: "Modification de l'équipement",
  maintenance: "Maintenance de l'équipement",
  controle_periodique: "Contrôle d'étanchéité périodique",
  controle_non_periodique: "Contrôle d'étanchéité non périodique",
  demantelement: "Démantèlement",
  autre: "Autre (préciser)",
} as const;
export type Nature = keyof typeof NATURES;

export interface LeakRow {
  location: string;
  repaired: boolean;
}

export interface SignatureBlock {
  name: string;
  quality: string;
  date: string;
  signaturePath: string | null;
}

/** Saisie propre à une unité extérieure (une fiche par équipement). */
export interface CerfaSystemInput {
  natures: Nature[];
  natureOther: string;
  permanentDetection: boolean;
  leaksFound: boolean;
  leaks: LeakRow[];
  /** kg : A vierge, B recyclé, C régénéré (null = valeur par défaut : complément de charge en vierge). */
  chargedVirginKg: number | null;
  chargedRecycledKg: number;
  chargedRegeneratedKg: number;
  /** kg : D destiné au traitement, E conservé pour réutilisation. */
  recoveredTreatmentKg: number;
  recoveredReuseKg: number;
  bsff: string;
  /** Identification du ou des contenants (cadre [11]). */
  containerId: string;
  destinationName: string;
  destinationSiret: string;
  destinationAddress: string;
  observations: string;
}

export interface CerfaInput {
  number?: string;
  systems: Record<string, Partial<CerfaSystemInput>>;
  operatorSign?: SignatureBlock;
  holderSign?: SignatureBlock;
}

export const DEFAULT_SYSTEM_INPUT: CerfaSystemInput = {
  natures: ["mise_en_service"],
  natureOther: "",
  permanentDetection: false,
  leaksFound: false,
  leaks: [],
  chargedVirginKg: null,
  chargedRecycledKg: 0,
  chargedRegeneratedKg: 0,
  recoveredTreatmentKg: 0,
  recoveredReuseKg: 0,
  bsff: "",
  containerId: "",
  destinationName: "",
  destinationSiret: "",
  destinationAddress: "",
  observations: "",
};

const kgNum = (v: unknown, max = 1000): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= max ? Math.round(v * 1000) / 1000 : null);
const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Validation des données reçues du navigateur. */
export function sanitizeSystemInput(raw: unknown): CerfaSystemInput {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const natures = Array.isArray(r.natures) ? [...new Set(r.natures.filter((n): n is Nature => typeof n === "string" && n in NATURES))] : DEFAULT_SYSTEM_INPUT.natures;
  const leaks = Array.isArray(r.leaks)
    ? r.leaks
        .slice(0, 3)
        .map((l) => ({ location: text((l as LeakRow)?.location, 120), repaired: Boolean((l as LeakRow)?.repaired) }))
        .filter((l) => l.location)
    : [];
  return {
    natures: natures.length ? natures : ["mise_en_service"],
    natureOther: text(r.natureOther, 120),
    permanentDetection: r.permanentDetection === true,
    leaksFound: r.leaksFound === true,
    leaks,
    chargedVirginKg: r.chargedVirginKg === null || r.chargedVirginKg === undefined ? null : kgNum(r.chargedVirginKg),
    chargedRecycledKg: kgNum(r.chargedRecycledKg) ?? 0,
    chargedRegeneratedKg: kgNum(r.chargedRegeneratedKg) ?? 0,
    recoveredTreatmentKg: kgNum(r.recoveredTreatmentKg) ?? 0,
    recoveredReuseKg: kgNum(r.recoveredReuseKg) ?? 0,
    bsff: text(r.bsff, 40),
    containerId: text(r.containerId, 60),
    destinationName: text(r.destinationName, 120),
    destinationSiret: text(r.destinationSiret, 20).replace(/\s/g, ""),
    destinationAddress: text(r.destinationAddress, 200),
    observations: text(r.observations, 1000),
  };
}

export function validateSystemInput(s: CerfaSystemInput): string | null {
  if (s.natures.includes("autre") && !s.natureOther) return "Précisez la nature « autre » de l'intervention.";
  if (s.leaksFound && s.leaks.length === 0) return "Indiquez la localisation de la fuite constatée.";
  if (s.recoveredTreatmentKg + s.recoveredReuseKg > 0 && !s.destinationName) return "Fluide récupéré : indiquez l'installation de destination (cadre 13).";
  return null;
}

export function sanitizeSignature(raw: unknown): SignatureBlock | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const path = typeof r.signaturePath === "string" && r.signaturePath && !r.signaturePath.includes("..") ? r.signaturePath.slice(0, 300) : null;
  return { name: text(r.name, 120), quality: text(r.quality, 80), date: /^\d{4}-\d{2}-\d{2}$/.test(String(r.date)) ? String(r.date) : "", signaturePath: path };
}

// ---------------------------------------------------------------------------
// Fiche pré-remplie
// ---------------------------------------------------------------------------

export interface CerfaSheet {
  /** N° de fiche (un suffixe par équipement s'il y a plusieurs unités extérieures). */
  number: string;
  tag: string;
  /** Formulaire officiel (France) ou fiche générique (autres pays). */
  format: "cerfa" | "generique";
  operator: { name: string; address: string; siret: string; capacityNumber: string | null };
  holder: { name: string; address: string; siret: string };
  installationAddress: string;
  equipment: { brand: string; model: string; serial: string; fluid: string; factoryChargeKg: number | null; complementKg: number | null; totalChargeKg: number | null; prg: number | null; teq: number | null };
  natures: Nature[];
  natureOther: string;
  leakDetector: { id: string; checkedOn: string };
  permanentDetection: boolean;
  /** [7]–[9] : famille du fluide pour les seuils. */
  hfc: boolean;
  hfo: boolean;
  leakCheckMonths: number | null;
  leakCheckText: string;
  leaksFound: boolean;
  leaks: LeakRow[];
  charged: { a: number; b: number; c: number; total: number };
  recovered: { d: number; e: number; total: number };
  bsff: string;
  containerId: string;
  adr: Adr | null;
  destination: { name: string; siret: string; address: string } | null;
  observations: string;
  operatorSign: SignatureBlock;
  holderSign: SignatureBlock;
  /** Alertes bloquantes ou rappels affichés sur la fiche et à l'écran. */
  warnings: string[];
  reminder: string | null;
}

export const NO_CAPACITY_WARNING = "Cette fiche doit être signée par un opérateur titulaire d'une attestation de capacité.";
export const KEEP_REMINDER = "Le détenteur conserve l'original de cette fiche au moins 5 ans (charge supérieure ou égale à 5 t éq. CO2).";

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** Complément de charge d'un système : mesuré à la mise en service, sinon calculé selon la longueur de liaison (arrondi 0,1 kg sup.). */
export function complementKg(sys: Equipment["systems"][number], metre: Metre, measuredG: number | null): number | null {
  if (measuredG !== null) return round3(measuredG / 1000);
  const o = sys.outdoor;
  if (o.prechargedLengthM === null || o.extraChargeGPerM === null) return null;
  const linkM = sys.indoors.reduce((a, i) => a + linkLength(metre, i.key), 0);
  const extra = Math.max(0, linkM - o.prechargedLengthM);
  return extra > 0 ? Math.ceil((extra * o.extraChargeGPerM) / 100 - 1e-9) / 10 : 0;
}

export function buildCerfaSheets(input: {
  country: string;
  number: string;
  company: { name: string; address: string; siret: string | null; capacityNumber: string | null; leakDetectorId: string | null; leakDetectorCheckedOn: string | null };
  client: { name: string; address: string; siret: string | null };
  installationAddress: string;
  equipment: Equipment;
  metre: Metre;
  tech: Record<string, UnitTech>;
  /** Saisies de mise en service (n° de série, charge ajoutée en g, essai d'étanchéité). */
  commissioning: Record<string, string>;
  form: CerfaInput;
}): CerfaSheet[] {
  const tags = equipmentTags(input.equipment);
  const multi = input.equipment.systems.length > 1;
  const empty: SignatureBlock = { name: "", quality: "", date: "", signaturePath: null };
  return input.equipment.systems.map((sys, i) => {
    const s = sanitizeSystemInput({ ...DEFAULT_SYSTEM_INPUT, ...(input.form.systems?.[sys.key] ?? {}) });
    const t = input.tech[sys.outdoor.id];
    const fluid = t?.refrigerant ? fluidLabel(t.refrigerant) : "R-32";
    const measured = input.commissioning[`${sys.key}.charge_g`];
    const measuredG = measured !== undefined && measured.trim() !== "" && Number.isFinite(Number(measured.replace(",", "."))) ? Number(measured.replace(",", ".")) : null;
    const complement = complementKg(sys, input.metre, measuredG);
    const factory = t?.factoryChargeKg ?? null;
    const total = factory !== null ? round3(factory + (complement ?? 0)) : null;
    const prg = prgOf(fluid);
    const teq = total !== null && prg !== null ? teqCo2(total, prg) : null;
    const hfc = HFC.has(normalizeFluid(fluid));
    const hfo = HFO.has(normalizeFluid(fluid));
    const months = hfc && teq !== null ? leakCheckMonths(teq, s.permanentDetection) : hfo && total !== null ? leakCheckMonthsHfo(total, s.permanentDetection) : null;
    const leakCheckText =
      hfo ? (total === null ? "Charge inconnue : à compléter." : months === null ? `${fluid} (HFO) : ${total.toLocaleString("fr-FR")} kg < 1 kg, aucun contrôle périodique obligatoire.` : `${fluid} (HFO) : ${total.toLocaleString("fr-FR")} kg, contrôle d'étanchéité tous les ${months} mois${s.permanentDetection ? " (détection permanente)" : ""}.`)
      : !hfc ? `${fluid} : fluide hors HFC / HFO, vérifier le seuil applicable (règlement (UE) 2024/573).`
      : teq === null ? "Charge ou PRG inconnus : tonnage à compléter."
      : months === null ? `${teq.toLocaleString("fr-FR")} t éq. CO2 < 5 t : aucun contrôle d'étanchéité périodique obligatoire.`
      : `${teq.toLocaleString("fr-FR")} t éq. CO2 : contrôle d'étanchéité tous les ${months} mois${s.permanentDetection ? " (détection permanente)" : ""}.`;
    const a = s.chargedVirginKg ?? complement ?? 0;
    const recoveredTotal = round3(s.recoveredTreatmentKg + s.recoveredReuseKg);
    const warnings: string[] = [];
    if (!input.company.capacityNumber) warnings.push(NO_CAPACITY_WARNING);
    if (!input.commissioning[`${sys.key}.serial`]) warnings.push("N° de série de l'unité extérieure à saisir (mise en service).");
    if (total === null) warnings.push("Charge usine inconnue : renseignez-la sur la fiche produit.");
    if (!input.company.leakDetectorId) warnings.push("Détecteur de fuite à renseigner (Paramètres › Fiche fluides).");
    return {
      number: multi ? `${input.number}-${i + 1}` : input.number,
      tag: tags.outdoor.get(sys.key) ?? "",
      format: input.country === "FR" ? "cerfa" : "generique",
      operator: { name: input.company.name, address: input.company.address, siret: input.company.siret ?? "", capacityNumber: input.company.capacityNumber },
      holder: { name: input.client.name, address: input.client.address, siret: input.client.siret ?? "" },
      installationAddress: input.installationAddress,
      equipment: { brand: sys.outdoor.brandName, model: sys.outdoor.reference, serial: input.commissioning[`${sys.key}.serial`]?.trim() ?? "", fluid, factoryChargeKg: factory, complementKg: complement, totalChargeKg: total, prg, teq },
      natures: s.natures,
      natureOther: s.natureOther,
      leakDetector: { id: input.company.leakDetectorId ?? "", checkedOn: input.company.leakDetectorCheckedOn ?? "" },
      permanentDetection: s.permanentDetection,
      hfc,
      hfo,
      leakCheckMonths: months,
      leakCheckText,
      leaksFound: s.leaksFound,
      leaks: s.leaksFound ? s.leaks : [],
      charged: { a: round3(a), b: s.chargedRecycledKg, c: s.chargedRegeneratedKg, total: round3(a + s.chargedRecycledKg + s.chargedRegeneratedKg) },
      recovered: { d: s.recoveredTreatmentKg, e: s.recoveredReuseKg, total: recoveredTotal },
      bsff: s.bsff,
      containerId: s.containerId,
      adr: recoveredTotal > 0 ? adrOf(fluid) : null,
      destination: recoveredTotal > 0 ? { name: s.destinationName, siret: s.destinationSiret, address: s.destinationAddress } : null,
      observations: s.observations,
      operatorSign: input.form.operatorSign ?? empty,
      holderSign: input.form.holderSign ?? empty,
      warnings,
      reminder: teq !== null && teq >= 5 ? KEEP_REMINDER : null,
    };
  });
}
