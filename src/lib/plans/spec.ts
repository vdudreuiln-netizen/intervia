/**
 * Cahiers des charges (PUR) :
 *  - version CLIENT : annexe du devis — équipements, emplacements (repères du
 *    plan), travaux compris, ce qui reste à la charge du client ;
 *  - version CHANTIER : dossier technique séparé, SANS aucun prix ni marge —
 *    matériel à charger, détail par unité (diamètres, longueurs, charge), contrôles.
 */
import { PRODUCT_TYPE_LABELS } from "@/lib/catalog/import";
import type { Equipment, Metre, RoomNeed } from "@/lib/quote/types";
import { DEFAULT_LINK_M, defaultDiameters, linkLength } from "@/lib/quote/lines";
import { LEVEL_LABELS } from "@/lib/quote/rooms";
import { equipmentTags } from "./layout";

export interface SpecSection {
  title: string;
  items: string[];
}

export interface SpecLine {
  /** Clé de la ligne du devis (wizard_key), si générée par l'assistant. */
  key: string | null;
  kind: "material" | "accessory" | "labor" | "travel" | "other";
  designation: string;
  quantity: number;
  unit: string;
}

export interface SpecInput {
  quoteNumber: string;
  client: { name: string; phone: string | null; email: string | null };
  site: { address: string | null; postalCode: string | null; city: string | null; parking: boolean };
  equipment: Equipment;
  rooms: RoomNeed[];
  metre: Metre;
  /** Lignes du devis telles qu'enregistrées (aucun prix). */
  lines: SpecLine[];
  laborDays: number;
  /** Étiquettes des plans d'implantation joints (ex. « Rez-de-chaussée »). */
  plans: string[];
}

const fmt = (n: number, d = 1) => n.toLocaleString("fr-FR", { maximumFractionDigits: d });
const has = (lines: SpecLine[], prefix: string) => lines.some((l) => l.key?.startsWith(prefix) && l.quantity > 0);
const qtyOf = (lines: SpecLine[], key: string) => lines.find((l) => l.key === key)?.quantity ?? null;

function roomsOf(input: SpecInput, ids: string[]): string {
  const names = new Map(input.rooms.map((r) => [r.id, r]));
  return ids.map((id) => names.get(id)?.name ?? "pièce").join(", ");
}

function levelOf(input: SpecInput, ids: string[]): string | null {
  const r = input.rooms.find((x) => x.id === ids[0]);
  return r ? LEVEL_LABELS[r.level] ?? `Niveau ${r.level}` : null;
}

const kindLabel = (t: string) => (PRODUCT_TYPE_LABELS as Record<string, string>)[t] ?? t;

export function buildClientSpec(input: SpecInput): SpecSection[] {
  const tags = equipmentTags(input.equipment);
  const eq = input.equipment;
  const indoorCount = eq.systems.reduce((n, s) => n + s.indoors.length, 0);
  const kind = eq.kind === "gainable" ? "gainable (réseau de gaines)" : eq.kind === "multi" ? "multi-split" : indoorCount > 1 ? "mono-split (une unité extérieure par pièce)" : "mono-split";
  const sections: SpecSection[] = [];

  sections.push({
    title: "Objet des travaux",
    items: [
      `Fourniture et pose d'une climatisation réversible air/air ${kind} : ${indoorCount} unité${indoorCount > 1 ? "s" : ""} intérieure${indoorCount > 1 ? "s" : ""} et ${eq.systems.length} unité${eq.systems.length > 1 ? "s" : ""} extérieure${eq.systems.length > 1 ? "s" : ""}, marque ${eq.brandName}.`,
      input.plans.length ? `Emplacements repérés sur le plan d'implantation joint (${input.plans.join(", ")}) : I = unité intérieure, E = unité extérieure, B = bouche, G = grille, T = tableau électrique, C = évacuation des condensats.` : "Emplacements à valider ensemble avant le début des travaux.",
    ],
  });

  const units: string[] = [];
  for (const sys of eq.systems) {
    for (const ind of sys.indoors) {
      const p = ind.product;
      const power = [p.coolingKw ? `${fmt(p.coolingKw)} kW froid` : null, p.heatingKw ? `${fmt(p.heatingKw)} kW chaud` : null].filter(Boolean).join(" / ");
      const lvl = levelOf(input, ind.roomIds);
      units.push(`${tags.indoor.get(ind.key)} – ${roomsOf(input, ind.roomIds)}${lvl ? ` (${lvl})` : ""} : ${kindLabel(p.type).toLowerCase()} ${p.brandName} ${p.reference}${power ? `, ${power}` : ""}.`);
    }
    const o = sys.outdoor;
    const support = has(input.lines, `support_sol:${sys.key}`) ? "posée au sol sur support" : "fixée en façade sur support mural";
    units.push(`${tags.outdoor.get(sys.key)} – unité extérieure ${o.brandName} ${o.reference}${o.coolingKw ? ` (${fmt(o.coolingKw)} kW)` : ""}, ${support}.`);
  }
  sections.push({ title: "Équipements installés", items: units });

  const works: string[] = ["Pose des unités intérieures et extérieure(s) aux emplacements convenus."];
  const totalLink = eq.systems.reduce((n, s) => n + s.indoors.reduce((m, i) => m + linkLength(input.metre, i.key), 0), 0);
  works.push(`Liaisons frigorifiques isolées en cuivre : environ ${fmt(totalLink)} m au total.`);
  if (has(input.lines, "goulotte:")) works.push("Goulotte de finition sur les liaisons apparentes à l'intérieur.");
  if (has(input.lines, "condensats:")) works.push("Évacuation des condensats raccordée à une évacuation existante" + (has(input.lines, "pompe:") ? ", avec pompe de relevage." : "."));
  if (has(input.lines, "cable:")) works.push("Alimentation électrique dédiée depuis le tableau, avec disjoncteur de protection.");
  if (has(input.lines, "gaine:")) works.push("Réseau de gaines isolées, plénum, bouches de soufflage et grille de reprise.");
  if (has(input.lines, "registre:")) works.push("Régulation par zones : un thermostat par pièce.");
  works.push("Mise en service : tirage au vide, test d'étanchéité, essais de fonctionnement, explication de l'utilisation.");
  if (has(input.lines, "cerfa:")) works.push("Fiche d'intervention réglementaire sur les fluides frigorigènes remise après la mise en service.");
  works.push(`Durée prévue : ${fmt(input.laborDays)} jour${input.laborDays > 1 ? "s" : ""} sur place.`);
  sections.push({ title: "Travaux compris", items: works });

  sections.push({
    title: "À la charge du client",
    items: [
      "Accès libre aux pièces et aux emplacements prévus le jour de l'intervention (meubles déplacés, passage dégagé).",
      "Tableau électrique en état permettant l'ajout d'un circuit dédié ; toute mise en conformité préalable fait l'objet d'un devis séparé.",
      "Autorisation de la copropriété et déclaration préalable en mairie lorsque l'unité extérieure est visible depuis l'espace public ou modifie l'aspect de la façade.",
      "Point d'évacuation des eaux accessible à proximité des unités intérieures.",
    ],
  });
  return sections;
}

export interface SiteUnitRow {
  tag: string;
  where: string;
  model: string;
  diameters: string;
  linkM: number;
  condensatsM: number | null;
  goulotteM: number | null;
  pump: boolean;
}

export interface SiteOutdoorRow {
  tag: string;
  model: string;
  support: string;
  electricM: number | null;
  totalLinkM: number;
  prechargedM: number | null;
  extraChargeG: number | null;
}

export interface SiteSpec {
  header: SpecSection;
  materials: { designation: string; quantity: string }[];
  indoors: SiteUnitRow[];
  outdoors: SiteOutdoorRow[];
  checks: SpecSection;
}

export function buildSiteSpec(input: SpecInput): SiteSpec {
  const tags = equipmentTags(input.equipment);
  const addr = [input.site.address, [input.site.postalCode, input.site.city].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const header: SpecSection = {
    title: "Chantier",
    items: [
      `Devis ${input.quoteNumber} – ${input.client.name}`,
      `Adresse : ${addr || "à préciser"}`,
      `Contact : ${[input.client.phone, input.client.email].filter(Boolean).join(" · ") || "à préciser"}`,
      input.site.parking ? "Stationnement payant prévu sur place." : "Stationnement : à vérifier avec le client.",
      `Durée prévue : ${fmt(input.laborDays)} jour${input.laborDays > 1 ? "s" : ""}.`,
    ],
  };
  const materials = input.lines
    .filter((l) => (l.kind === "material" || l.kind === "accessory") && l.quantity > 0)
    .map((l) => ({ designation: l.designation, quantity: `${fmt(l.quantity, 2)} ${l.unit === "u" ? "" : l.unit}`.trim() }));

  const indoors: SiteUnitRow[] = [];
  const outdoors: SiteOutdoorRow[] = [];
  for (const sys of input.equipment.systems) {
    let total = 0;
    for (const ind of sys.indoors) {
      const link = linkLength(input.metre, ind.key) ?? DEFAULT_LINK_M;
      total += link;
      indoors.push({
        tag: tags.indoor.get(ind.key)!,
        where: roomsOf(input, ind.roomIds),
        model: `${ind.product.brandName} ${ind.product.reference}`,
        diameters: ind.product.linkDiameters ?? sys.outdoor.linkDiameters ?? defaultDiameters(ind.product.coolingKw ?? 0),
        linkM: link,
        condensatsM: qtyOf(input.lines, `condensats:${ind.key}`),
        goulotteM: qtyOf(input.lines, `goulotte:${ind.key}`),
        pump: has(input.lines, `pompe:${ind.key}`),
      });
    }
    const o = sys.outdoor;
    const extra = o.prechargedLengthM !== null && o.extraChargeGPerM !== null ? Math.max(0, Math.round((total - o.prechargedLengthM) * o.extraChargeGPerM)) : null;
    outdoors.push({
      tag: tags.outdoor.get(sys.key)!,
      model: `${o.brandName} ${o.reference}`,
      support: has(input.lines, `support_sol:${sys.key}`) ? "Support au sol" : "Support mural",
      electricM: qtyOf(input.lines, `cable:${sys.key}`),
      totalLinkM: Math.round(total * 10) / 10,
      prechargedM: o.prechargedLengthM,
      extraChargeG: extra,
    });
  }
  const checks: SpecSection = {
    title: "Contrôles et mise en service",
    items: [
      "Vérifier les emplacements avec le client avant tout perçage (repères du plan).",
      "Pente des condensats vers l'évacuation ; essai d'écoulement à l'eau.",
      "Test d'étanchéité à l'azote, tirage au vide, contrôle du vide avant ouverture des vannes.",
      "Ajuster la charge si la longueur réelle diffère du plan (charge complémentaire indiquée par unité extérieure).",
      "Serrage et repérage des câbles ; essai du disjoncteur dédié.",
      "Essais chaud / froid, explication au client, remise de la notice et de la fiche d'intervention fluides.",
    ],
  };
  return { header, materials, indoors, outdoors, checks };
}
