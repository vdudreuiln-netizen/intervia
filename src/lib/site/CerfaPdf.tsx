/**
 * Fiche d'intervention fluides : reproduction du formulaire CERFA n° 15497*04
 * (France), cadres [1] à [14], pré-remplie. Hors France : même contenu sous
 * forme de fiche générique (règlement (UE) 2024/573).
 * Aucun coût ni marge n'arrive ici.
 */
import { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { ReactNode } from "react";
import { NATURES, type CerfaSheet, type Nature } from "./cerfa";
import type { PdfImg } from "./SitePdfs";

const C = { ink: "#111827", muted: "#4B5563", line: "#6B7280", head: "#E5E7EB", red: "#B91C1C" };
const clean = (v: string) => v.replace(/[  ]/g, " ").replace(/[→]/g, "->");
const kg = (n: number | null) => (n === null ? "" : clean(`${n.toLocaleString("fr-FR", { maximumFractionDigits: 3 })} kg`));
const frDay = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.split("-").reverse().join("/") : iso);

const s = StyleSheet.create({
  page: { paddingTop: 20, paddingBottom: 34, paddingHorizontal: 24, fontSize: 7.5, color: C.ink, fontFamily: "Helvetica", lineHeight: 1.25 },
  top: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 },
  cerfa: { fontSize: 8, fontFamily: "Helvetica-Bold" },
  title: { fontSize: 11, fontFamily: "Helvetica-Bold", textAlign: "center" },
  subtitle: { fontSize: 7.5, textAlign: "center", color: C.muted },
  number: { borderWidth: 1, borderColor: C.ink, padding: 3, fontFamily: "Helvetica-Bold", fontSize: 9 },
  row: { flexDirection: "row", gap: 4, marginTop: 4 },
  box: { flex: 1, borderWidth: 0.8, borderColor: C.line, padding: 4 },
  head: { backgroundColor: C.head, marginHorizontal: -4, marginTop: -4, marginBottom: 3, paddingHorizontal: 4, paddingVertical: 2, fontFamily: "Helvetica-Bold", fontSize: 7.5 },
  kv: { flexDirection: "row", marginBottom: 1.5 },
  k: { width: 112, color: C.muted },
  v: { flex: 1, fontFamily: "Helvetica-Bold" },
  todo: { flex: 1, color: C.red },
  check: { flexDirection: "row", alignItems: "center", marginRight: 8, marginBottom: 2 },
  sq: { width: 8, height: 8, borderWidth: 0.8, borderColor: C.ink, marginRight: 3, alignItems: "center", justifyContent: "center" },
  x: { width: 5, height: 5, backgroundColor: C.ink },
  wrap: { flexDirection: "row", flexWrap: "wrap" },
  table: { borderTopWidth: 0.5, borderTopColor: C.line },
  tr: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: C.line, paddingVertical: 1.5 },
  warn: { borderWidth: 1, borderColor: C.red, color: C.red, padding: 4, marginTop: 4, fontFamily: "Helvetica-Bold" },
  sign: { flex: 1, borderWidth: 0.8, borderColor: C.ink, padding: 4, minHeight: 78 },
  footer: { position: "absolute", bottom: 14, left: 24, right: 24, fontSize: 6.5, color: C.muted, textAlign: "center" },
});

function Box({ n, title, children, flex = 1 }: { n: number | string; title: string; children: ReactNode; flex?: number }) {
  return (
    <View style={[s.box, { flex }]} wrap={false}>
      <Text style={s.head}>
        [{n}] {clean(title)}
      </Text>
      {children}
    </View>
  );
}

function KV({ k, v, todo = "à compléter" }: { k: string; v: string | null | undefined; todo?: string }) {
  const val = v && v.trim() ? v : null;
  return (
    <View style={s.kv}>
      <Text style={s.k}>{clean(k)}</Text>
      <Text style={val ? s.v : todo === "à compléter" ? s.todo : { flex: 1, color: C.muted }}>{clean(val ?? todo)}</Text>
    </View>
  );
}

function Check({ on, label }: { on: boolean; label: string }) {
  return (
    <View style={s.check}>
      <View style={s.sq}>{on ? <View style={s.x} /> : null}</View>
      <Text>{clean(label)}</Text>
    </View>
  );
}

function Signature({ title, block, image }: { title: string; block: CerfaSheet["operatorSign"]; image: PdfImg | null }) {
  return (
    <View style={s.sign}>
      <Text style={{ fontFamily: "Helvetica-Bold", marginBottom: 2 }}>{clean(title)}</Text>
      <KV k="Nom" v={block.name} todo="" />
      <KV k="Qualité" v={block.quality} todo="" />
      <KV k="Date" v={frDay(block.date)} todo="" />
      <Text style={{ color: C.muted }}>Signature :</Text>
      {image ? <Image src={{ data: image.data, format: image.format }} style={{ height: 34, objectFit: "contain", alignSelf: "flex-start" }} /> : null}
    </View>
  );
}

const ORDER: Nature[] = ["assemblage", "mise_en_service", "modification", "maintenance", "controle_periodique", "controle_non_periodique", "demantelement", "autre"];

function Sheet({ f, signatures }: { f: CerfaSheet; signatures: { operator: PdfImg | null; holder: PdfImg | null } }) {
  const official = f.format === "cerfa";
  const eq = f.equipment;
  const t = eq.teq;
  const band = !f.hfc || t === null ? -1 : t < 5 ? 0 : t < 50 ? 1 : t < 500 ? 2 : 3;
  return (
    <Page size="A4" style={s.page}>
      <View style={s.top}>
        <View>
          <Text style={s.cerfa}>{official ? "cerfa N° 15497*04" : "F-gas"}</Text>
          <Text style={{ color: C.muted }}>{official ? "Article R. 543-82 du code de l'environnement" : "Règlement (UE) 2024/573"}</Text>
        </View>
        <View style={{ flex: 1, paddingHorizontal: 8 }}>
          <Text style={s.title}>FICHE D&apos;INTERVENTION</Text>
          <Text style={s.subtitle}>Opérations sur un équipement contenant des fluides frigorigènes{official ? "" : " (gaz à effet de serre fluorés)"}</Text>
        </View>
        <Text style={s.number}>Fiche n° {clean(f.number)}</Text>
      </View>

      <View style={s.row}>
        <Box n={1} title="Opérateur">
          <KV k="Nom / raison sociale" v={f.operator.name} />
          <KV k="Adresse" v={f.operator.address} />
          <KV k="SIRET" v={f.operator.siret} />
          <KV k="N° d'attestation de capacité" v={f.operator.capacityNumber} />
        </Box>
        <Box n={2} title="Détenteur">
          <KV k="Nom / raison sociale" v={f.holder.name} />
          <KV k="Adresse" v={f.holder.address} />
          <KV k="SIRET" v={f.holder.siret} todo="(particulier : sans objet)" />
          {f.installationAddress && f.installationAddress !== f.holder.address ? <KV k="Lieu de l'équipement" v={f.installationAddress} /> : null}
        </Box>
      </View>

      <View style={s.row}>
        <Box n={3} title="Équipement concerné" flex={1.2}>
          <KV k="Marque / modèle" v={`${eq.brand} ${eq.model}`} />
          <KV k="N° de série" v={eq.serial} />
          <KV k="Fluide frigorigène" v={eq.fluid} />
          <KV k="Charge totale" v={eq.totalChargeKg === null ? null : `${kg(eq.totalChargeKg)} (usine ${kg(eq.factoryChargeKg)} + complément ${kg(eq.complementKg ?? 0)})`} />
          <KV k="Tonnage éq. CO2" v={eq.teq === null ? null : `${eq.teq.toLocaleString("fr-FR")} t éq. CO2 (PRG ${eq.prg})`} />
        </Box>
        <Box n={4} title="Nature de l'intervention">
          <View style={s.wrap}>
            {ORDER.map((n) => (
              <Check key={n} on={f.natures.includes(n)} label={n === "autre" && f.natureOther ? `Autre : ${f.natureOther}` : NATURES[n]} />
            ))}
          </View>
        </Box>
      </View>

      <View style={s.row}>
        <Box n={5} title="Détecteur manuel de fuite">
          <KV k="Identification" v={f.leakDetector.id} />
          <KV k="Date du dernier contrôle" v={frDay(f.leakDetector.checkedOn)} />
        </Box>
        <Box n={6} title="Système de détection permanente des fuites">
          <View style={s.wrap}>
            <Check on={f.permanentDetection} label="Oui" />
            <Check on={!f.permanentDetection} label="Non" />
          </View>
        </Box>
      </View>

      <View style={s.row}>
        <Box n="7-9" title="Fréquence minimale du contrôle d'étanchéité">
          <View style={s.wrap}>
            <Check on={band === 0} label="Pas de contrôle périodique (< 5 t éq. CO2)" />
            <Check on={band === 1} label="5 à < 50 t : 12 mois (24 si détection permanente)" />
            <Check on={band === 2} label="50 à < 500 t : 6 mois (12 si détection permanente)" />
            <Check on={band === 3} label="500 t et plus : 3 mois (6 si détection permanente)" />
          </View>
          <Text style={{ marginTop: 2, fontFamily: "Helvetica-Bold" }}>{clean(f.leakCheckText)}</Text>
        </Box>
      </View>

      <View style={s.row}>
        <Box n={10} title="Fuites constatées lors du contrôle d'étanchéité">
          <View style={s.wrap}>
            <Check on={f.leaksFound} label="Oui" />
            <Check on={!f.leaksFound} label="Non" />
          </View>
          <View style={s.table}>
            <View style={[s.tr, { fontFamily: "Helvetica-Bold" }]}>
              <Text style={{ width: 14 }}>n°</Text>
              <Text style={{ flex: 1 }}>Localisation de la fuite</Text>
              <Text style={{ width: 84 }}>Réparation réalisée</Text>
              <Text style={{ width: 60 }}>À faire</Text>
            </View>
            {[0, 1, 2].map((i) => {
              const l = f.leaks[i];
              return (
                <View key={i} style={s.tr}>
                  <Text style={{ width: 14 }}>{i + 1}</Text>
                  <Text style={{ flex: 1 }}>{l ? clean(l.location) : ""}</Text>
                  <Text style={{ width: 84 }}>{l && l.repaired ? "X" : ""}</Text>
                  <Text style={{ width: 60 }}>{l && !l.repaired ? "X" : ""}</Text>
                </View>
              );
            })}
          </View>
        </Box>
      </View>

      <View style={s.row}>
        <Box n={11} title="Manipulation du fluide frigorigène">
          <View style={{ flexDirection: "row", gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: "Helvetica-Bold" }}>Quantité chargée</Text>
              <KV k="A – fluide vierge" v={kg(f.charged.a)} />
              <KV k="B – fluide recyclé" v={kg(f.charged.b)} />
              <KV k="C – fluide régénéré" v={kg(f.charged.c)} />
              <KV k="Total A + B + C" v={kg(f.charged.total)} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: "Helvetica-Bold" }}>Quantité récupérée</Text>
              <KV k="D – destinée au traitement" v={kg(f.recovered.d)} />
              <KV k="E – conservée (réutilisation)" v={kg(f.recovered.e)} />
              <KV k="Total D + E" v={kg(f.recovered.total)} />
              <KV k="N° BSFF (Trackdéchets)" v={f.bsff} todo={f.recovered.d > 0 ? "à compléter" : "sans objet"} />
            </View>
          </View>
        </Box>
      </View>

      <View style={s.row}>
        <Box n={12} title="Transport (ADR / RID) et déchet">
          {f.adr ? (
            <>
              <KV k="N° ONU" v={`${f.adr.un} – ${f.adr.designation}`} />
              <KV k="Code déchet" v={f.adr.waste} />
            </>
          ) : (
            <Text style={{ color: C.muted }}>Sans objet : aucun fluide récupéré.</Text>
          )}
        </Box>
        <Box n={13} title="Installation de destination du fluide récupéré">
          {f.destination ? (
            <>
              <KV k="Nom" v={f.destination.name} />
              <KV k="Adresse" v={f.destination.address} />
            </>
          ) : (
            <Text style={{ color: C.muted }}>Sans objet : aucun fluide récupéré.</Text>
          )}
        </Box>
      </View>

      <View style={s.row}>
        <Box n={14} title="Observations">
          <Text>{clean(f.observations || " ")}</Text>
        </Box>
      </View>

      {f.warnings.map((w) => (
        <Text key={w} style={s.warn}>
          {clean(w)}
        </Text>
      ))}

      <View style={s.row} wrap={false}>
        <Signature title="Opérateur" block={f.operatorSign} image={signatures.operator} />
        <Signature title="Détenteur" block={f.holderSign} image={signatures.holder} />
      </View>
      {f.reminder ? <Text style={{ marginTop: 4, fontFamily: "Helvetica-Bold" }}>{clean(f.reminder)}</Text> : null}
      <Text style={s.footer} fixed>
        {official
          ? "Original conservé par le détenteur, copie conservée par l'opérateur. Formulaire CERFA n° 15497*04 reproduit et pré-rempli par le logiciel de l'opérateur."
          : "Fiche d'intervention établie selon le règlement (UE) 2024/573 relatif aux gaz à effet de serre fluorés. Original conservé par le détenteur, copie par l'opérateur."}
      </Text>
    </Page>
  );
}

export function CerfaPdf({ sheets, company, signatures }: { sheets: CerfaSheet[]; company: string; signatures: { operator: PdfImg | null; holder: PdfImg | null } }) {
  return (
    <Document title={`Fiche d'intervention ${sheets[0]?.number ?? ""}`} author={company} subject="Fiche d'intervention fluides frigorigènes" language="fr-FR">
      {sheets.map((f) => (
        <Sheet key={f.number} f={f} signatures={signatures} />
      ))}
    </Document>
  );
}
