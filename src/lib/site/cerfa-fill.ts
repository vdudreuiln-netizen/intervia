/**
 * Remplissage du formulaire OFFICIEL CERFA n° 15497*04 (PDF de service-public.gouv.fr,
 * champs de formulaire nommés), une page par unité extérieure, champs aplatis
 * pour que la fiche ne soit plus modifiable après édition.
 */
import { PDFArray, PDFDocument, PDFName, StandardFonts, type PDFFont, type PDFForm, type PDFPage } from "pdf-lib";
import type { CerfaSheet } from "./cerfa";
import { NO_CAPACITY_WARNING } from "./cerfa";

export type SignatureImage = { data: Uint8Array; format: "png" | "jpg" } | null;

const REPLACE: Record<string, string> = { " ": " ", " ": " ", "≥": ">=", "≤": "<=", "→": "->", "✔": "", "⚠": "" };

/** Le formulaire utilise Helvetica (WinAnsi) : on retire les caractères non représentables. */
export function cleaner(font: PDFFont) {
  return (v: string) =>
    [...v]
      .map((ch) => REPLACE[ch] ?? ch)
      .join("")
      .split("")
      .filter((ch) => {
        if (ch === "\n") return true;
        try {
          font.encodeText(ch);
          return true;
        } catch {
          return false;
        }
      })
      .join("");
}

const num = (n: number | null) => (n === null ? "" : n.toLocaleString("fr-FR", { maximumFractionDigits: 3 }).replace(/\s/g, ""));
const isoParts = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.split("-") : null);
const frDate = (iso: string) => {
  const p = isoParts(iso);
  return p ? `${p[2]}/${p[1]}/${p[0]}` : iso;
};

export function fillSheetForm(form: PDFForm, font: PDFFont, clean: (v: string) => string, f: CerfaSheet) {
  const text = (name: string, value: string, size = 7, fit = true) => {
    const field = form.getTextField(name);
    const v = clean(value);
    const w = field.acroField.getWidgets()[0]!.getRectangle().width - 4;
    const s = fit && !field.isMultiline() && v ? Math.max(3.5, Math.min(size, w / Math.max(1, font.widthOfTextAtSize(v, 1)))) : size;
    field.setText(v);
    field.setFontSize(s);
  };
  const check = (name: string, on: boolean) => {
    const c = form.getCheckBox(name);
    if (on) c.check();
    else c.uncheck();
  };

  const e = f.equipment;
  text("Fiche_no", f.number, 9);
  text("Operateur", [f.operator.name, f.operator.address, f.operator.siret ? `SIRET ${f.operator.siret}` : ""].filter(Boolean).join("\n"), 7);
  text("Attestation_no", f.operator.capacityNumber ?? "", 7);
  const place = f.installationAddress && f.installationAddress !== f.holder.address ? `Lieu de l'équipement : ${f.installationAddress}` : "";
  text("Detenteur", [f.holder.name, f.holder.address, f.holder.siret ? `SIRET ${f.holder.siret}` : "", place].filter(Boolean).join("\n"), 7);
  text("Equipement_ID", [`${e.brand} ${e.model}`, e.serial ? `N° de série : ${e.serial}` : ""].filter(Boolean).join("\n"), 7);
  text("Equipement_Fluide", e.fluid.replace(/^R-?/i, ""), 7);
  text("Equipement_Charge", num(e.totalChargeKg), 7);
  text("Equipement_teqCO2", num(e.teq), 7);

  // [4]
  check("Case_Assemblage", f.natures.includes("assemblage"));
  check("Case_MiseService", f.natures.includes("mise_en_service"));
  check("Case_Modif", f.natures.includes("modification"));
  check("Case_Maintenance", f.natures.includes("maintenance"));
  check("Case_CtrlPerio", f.natures.includes("controle_periodique"));
  check("Case_CtrlNonPerio", f.natures.includes("controle_non_periodique"));
  check("Case_Demantel", f.natures.includes("demantelement"));
  check("Case_Autre", f.natures.includes("autre"));
  text("Autre", f.natures.includes("autre") ? f.natureOther : "", 7);

  // [5] [6]
  text("Detecteur_ID", f.leakDetector.id, 7);
  const d = isoParts(f.leakDetector.checkedOn);
  text("Controle_Jour", d ? d[2]! : "", 7);
  text("Controle_Mois", d ? d[1]! : "", 7);
  text("Controle_Annee", d ? d[0]! : "", 7);
  const radio = form.getRadioGroup("Bouton_Oui");
  const [yes, no] = radio.getOptions();
  radio.select((f.permanentDetection ? yes : no)!);

  // [7] [8] [9] : tranche selon la famille, jamais de case sous le premier seuil
  const t = e.teq;
  const kg = e.totalChargeKg;
  const band = f.hfc && t !== null ? (t < 5 ? 0 : t < 50 ? 1 : t < 500 ? 2 : 3) : f.hfo && kg !== null ? (kg < 1 ? 0 : kg < 10 ? 1 : kg < 100 ? 2 : 3) : 0;
  const fam = f.hfc ? "HFC" : f.hfo ? "HFO" : null;
  const thresholds = { HFC: ["5", "50", "500"], HFO: ["1", "10", "100"] } as const;
  for (const famName of ["HFC", "HFO"] as const) thresholds[famName].forEach((th, i) => check(`Case_${famName}_${th}`, fam === famName && band === i + 1));
  for (const n of ["Case_HCFC_2", "Case_HCFC_30", "Case_HCFC_300"]) check(n, false);
  (["12m", "6m", "3m"] as const).forEach((m, i) => check(`Case_Sans_${m}`, band === i + 1 && !f.permanentDetection));
  (["24m", "12m", "6m"] as const).forEach((m, i) => check(`Case_Avec_${m}`, band === i + 1 && f.permanentDetection));

  // [10]
  check("Case_Fuite_Oui", f.leaksFound);
  check("Case_Fuite_Non", !f.leaksFound);
  for (let i = 0; i < 3; i++) {
    const l = f.leaks[i];
    text(`Fuite_Loca_${i + 1}`, l?.location ?? "", 7);
    check(`Case_Rep_Fuite${i + 1}_realisee`, Boolean(l && l.repaired));
    check(`Case_Rep_Fuite${i + 1}_AFaire`, Boolean(l && !l.repaired));
  }

  // [11]
  text("11_Quantite", num(f.charged.total), 7);
  text("11_QA", num(f.charged.a), 7);
  text("11_Denom", "", 7);
  text("11_QB", num(f.charged.b), 7);
  text("11_QC", num(f.charged.c), 7);
  text("11_QDE", num(f.recovered.total), 7);
  text("11_QD", num(f.recovered.d), 7);
  text("11_QE", num(f.recovered.e), 7);
  text("11_BSFF", f.bsff, 7);
  text("11_Contenant_ID", f.containerId, 7);

  // [12] [13] : seulement s'il y a du fluide récupéré
  const a = f.adr;
  check("Case_12_UN1078", a?.box === "UN1078");
  check("Case_12_Autre140601", a?.box === "autre_non_inflammable");
  check("Case_12_UN3161", a?.box === "UN3161");
  check("Case_12_Autre160504", a?.box === "autre_inflammable");
  text("Autre-FF-NON-inflammable", a?.box === "autre_non_inflammable" ? a.other : "", 6);
  text("Autre-FF-inflammable", a?.box === "autre_inflammable" ? a.other : "", 6);
  text("13_Instal", f.destination ? [f.destination.name, f.destination.siret ? `SIRET ${f.destination.siret}` : "", f.destination.address].filter(Boolean).join(" – ") : "", 7);

  // [14] : observations + rappels utiles (texte du cadre [12] en entier, attestation manquante)
  const notes = [f.observations];
  if (a?.other) notes.push(`[12] ${a.flammable ? "Autres fluides frigorigènes inflammables" : "Autres fluides frigorigènes non-inflammables"} : ${a.other} (rubrique déchets ${a.waste}).`);
  if (!f.hfc && !f.hfo) notes.push(f.leakCheckText);
  if (f.warnings.includes(NO_CAPACITY_WARNING)) notes.push(NO_CAPACITY_WARNING);
  text("14_Observations", notes.filter(Boolean).join("\n"), 7);

  // Signataires
  text("Sign_Operateur_Nom", f.operatorSign.name, 7);
  text("Sign_Operateur_Qualite", f.operatorSign.quality, 7);
  text("Sign_Operateur_Date", frDate(f.operatorSign.date), 7, false);
  text("Sign_Detenteur_Nom", f.holderSign.name, 7);
  text("Sign_Detenteur_Qualite", f.holderSign.quality, 7);
  text("Sign_Detenteur_Date", frDate(f.holderSign.date), 7, false);
}

async function drawSignature(doc: PDFDocument, page: PDFPage, rect: { x: number; y: number; width: number; height: number }, img: SignatureImage) {
  if (!img) return;
  const image = img.format === "png" ? await doc.embedPng(img.data) : await doc.embedJpg(img.data);
  // à droite de la date, dans la case « Date et signature »
  const box = { x: rect.x + 55, y: rect.y + 0.5, width: rect.width - 57, height: rect.height - 1 };
  const scale = Math.min(box.width / image.width, box.height / image.height);
  page.drawImage(image, { x: box.x, y: box.y, width: image.width * scale, height: image.height * scale });
}

/** Une page du formulaire officiel par fiche (unité extérieure), aplatie. */
export async function fillOfficialCerfa(template: Uint8Array, sheets: CerfaSheet[], signatures: { operator: SignatureImage; holder: SignatureImage }): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  out.setTitle(`Fiche d'intervention ${sheets[0]?.number ?? ""} – CERFA 15497*04`);
  out.setSubject("Fiche d'intervention fluides frigorigènes (CERFA n° 15497*04)");
  out.setLanguage("fr-FR");
  for (const sheet of sheets) {
    const doc = await PDFDocument.load(template);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const form = doc.getForm();
    fillSheetForm(form, font, cleaner(font), sheet);
    const rect = (n: string) => form.getTextField(n).acroField.getWidgets()[0]!.getRectangle();
    const opRect = rect("Sign_Operateur_Date");
    const hoRect = rect("Sign_Detenteur_Date");
    form.updateFieldAppearances(font);
    form.flatten();
    const page = doc.getPage(0);
    // Après aplatissement, la page garde des références vers des champs supprimés : on les retire
    const annots = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
    if (annots) {
      const kept = annots.asArray().filter((ref) => doc.context.lookup(ref) !== undefined);
      if (kept.length) page.node.set(PDFName.of("Annots"), doc.context.obj(kept));
      else page.node.delete(PDFName.of("Annots"));
    }
    await drawSignature(doc, page, opRect, signatures.operator);
    await drawSignature(doc, page, hoRect, signatures.holder);
    const [copied] = await out.copyPages(doc, [0]);
    out.addPage(copied!);
  }
  return out.save({ useObjectStreams: false });
}
