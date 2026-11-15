/**
 * PDF du mode chantier : procès-verbal de réception (avec photos), fiche
 * fluides préremplie, avenant au devis. Aucun coût ni marge n'arrive ici.
 */
import { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { pdfEuros } from "@/lib/pdf/QuotePdf";
import { RECEPTION_LEGAL, type Amendment, type FluidForm } from "./site";

const C = { ink: "#111827", muted: "#4B5563", line: "#D1D5DB", brand: "#0B4F8A", light: "#E6F0FA" };
const clean = (v: string) => v.replace(/[  ]/g, " ").replace(/[→]/g, "->");
const s = StyleSheet.create({
  page: { paddingTop: 30, paddingBottom: 50, paddingHorizontal: 36, fontSize: 9.5, color: C.ink, fontFamily: "Helvetica", lineHeight: 1.35 },
  title: { fontSize: 17, fontFamily: "Helvetica-Bold", color: C.brand, marginBottom: 4 },
  h2: { fontSize: 11, fontFamily: "Helvetica-Bold", color: C.brand, marginTop: 12, marginBottom: 4 },
  bold: { fontFamily: "Helvetica-Bold" },
  muted: { color: C.muted },
  boxes: { flexDirection: "row", gap: 10, marginTop: 8 },
  box: { flex: 1, borderWidth: 1, borderColor: C.line, borderRadius: 4, padding: 8 },
  label: { fontSize: 8, color: C.muted, textTransform: "uppercase", fontFamily: "Helvetica-Bold", marginBottom: 3 },
  row: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: C.line, paddingVertical: 4 },
  th: { flexDirection: "row", backgroundColor: C.brand, color: "white", fontFamily: "Helvetica-Bold", fontSize: 8.5, paddingVertical: 5, paddingHorizontal: 6 },
  tr: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: C.line, paddingVertical: 5, paddingHorizontal: 6 },
  sign: { flex: 1, borderWidth: 1, borderColor: C.ink, borderRadius: 4, padding: 8, minHeight: 110 },
  footer: { position: "absolute", bottom: 22, left: 36, right: 36, borderTopWidth: 0.5, borderTopColor: C.line, paddingTop: 4, fontSize: 7.5, color: C.muted, flexDirection: "row", justifyContent: "space-between" },
  photos: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  photo: { width: 168 },
});

export interface PdfParty {
  name: string;
  lines: string[];
}
export type PdfImg = { data: Buffer; format: "png" | "jpg" };

function Footer({ left, right }: { left: string; right: string }) {
  return (
    <View style={s.footer} fixed>
      <Text>{clean(left)}</Text>
      <Text>{clean(right)}</Text>
    </View>
  );
}

function Parties({ company, client, clientLabel = "Client" }: { company: PdfParty; client: PdfParty; clientLabel?: string }) {
  return (
    <View style={s.boxes}>
      <View style={s.box}>
        <Text style={s.label}>Entreprise</Text>
        <Text style={s.bold}>{clean(company.name)}</Text>
        {company.lines.map((l) => (
          <Text key={l}>{clean(l)}</Text>
        ))}
      </View>
      <View style={s.box}>
        <Text style={s.label}>{clientLabel}</Text>
        <Text style={s.bold}>{clean(client.name)}</Text>
        {client.lines.map((l) => (
          <Text key={l}>{clean(l)}</Text>
        ))}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Procès-verbal de réception
// ---------------------------------------------------------------------------
export function ReceptionPdf({
  company,
  client,
  quoteNumber,
  works,
  reserves,
  signerName,
  signedAt,
  signature,
  photos,
}: {
  company: PdfParty;
  client: PdfParty;
  quoteNumber: string;
  works: string[];
  reserves: string[];
  signerName: string;
  signedAt: string;
  signature: PdfImg | null;
  photos: { image: PdfImg; caption: string }[];
}) {
  const footer = { left: `${company.name} · Procès-verbal de réception`, right: `Devis ${quoteNumber}` };
  return (
    <Document title={`Procès-verbal de réception ${quoteNumber}`} author={company.name} subject="Réception des travaux" language="fr-FR">
      <Page size="A4" style={s.page}>
        <Footer {...footer} />
        <Text style={s.title}>PROCÈS-VERBAL DE RÉCEPTION DES TRAVAUX</Text>
        <Text>
          Devis n° {quoteNumber} · Réception du {signedAt}
        </Text>
        <Parties company={company} client={client} clientLabel="Maître d'ouvrage (client)" />

        <Text style={s.h2}>Travaux réalisés</Text>
        {works.map((w) => (
          <Text key={w}>• {clean(w)}</Text>
        ))}

        <Text style={s.h2}>Décision du client</Text>
        <Text style={s.bold}>{reserves.length === 0 ? "Le client déclare accepter les travaux SANS RÉSERVE." : `Le client déclare accepter les travaux AVEC ${reserves.length} RÉSERVE${reserves.length > 1 ? "S" : ""} :`}</Text>
        {reserves.map((r, i) => (
          <Text key={i}>
            {i + 1}. {clean(r)}
          </Text>
        ))}
        {reserves.length > 0 && <Text style={[s.muted, { marginTop: 3 }]}>L&apos;entreprise s&apos;engage à lever ces réserves dans le délai convenu avec le client.</Text>}
        <Text style={[s.muted, { marginTop: 8, fontSize: 8.5 }]}>{RECEPTION_LEGAL}</Text>

        <View style={[s.boxes, { marginTop: 14 }]} wrap={false}>
          <View style={s.sign}>
            <Text style={s.label}>L&apos;entreprise</Text>
            <Text>{clean(company.name)}</Text>
          </View>
          <View style={s.sign}>
            <Text style={s.label}>Le client : {clean(signerName)}</Text>
            <Text style={s.muted}>Signé sur écran le {signedAt}</Text>
            {signature && <Image src={signature} style={{ width: 200, height: 70, objectFit: "contain", marginTop: 4 }} />}
          </View>
        </View>
      </Page>
      {photos.length > 0 && (
        <Page size="A4" style={s.page}>
          <Footer {...footer} />
          <Text style={s.title}>Photos du chantier</Text>
          <View style={s.photos}>
            {photos.map((p, i) => (
              <View key={i} style={s.photo} wrap={false}>
                <Image src={p.image} style={{ width: 168, height: 126, objectFit: "cover" }} />
                <Text style={{ fontSize: 8, marginTop: 2 }}>{clean(p.caption)}</Text>
              </View>
            ))}
          </View>
        </Page>
      )}
    </Document>
  );
}

// ---------------------------------------------------------------------------
// Fiche fluides préremplie
// ---------------------------------------------------------------------------
function Rows({ rows }: { rows: { label: string; value: string }[] }) {
  return (
    <>
      {rows.map((r) => (
        <View key={r.label} style={s.row} wrap={false}>
          <Text style={{ width: 190, color: C.muted }}>{clean(r.label)}</Text>
          <Text style={[{ flex: 1 }, r.value.startsWith("à compléter") ? { color: "#B91C1C" } : s.bold]}>{clean(r.value)}</Text>
        </View>
      ))}
    </>
  );
}

export function FluidPdf({ form, company, quoteNumber }: { form: FluidForm; company: string; quoteNumber: string }) {
  return (
    <Document title={`Fiche fluides ${quoteNumber}`} author={company} subject="Fiche d'intervention fluides frigorigènes" language="fr-FR">
      <Page size="A4" style={s.page}>
        <Footer left={`${company} · Fiche fluides`} right={`Devis ${quoteNumber}`} />
        <Text style={s.title}>FICHE D&apos;INTERVENTION – FLUIDES FRIGORIGÈNES</Text>
        <Text style={s.muted}>Données préremplies depuis le devis et la mise en service, à reporter sur le formulaire officiel CERFA n° 15497*04. En rouge : à compléter.</Text>
        <Text style={s.h2}>Opérateur</Text>
        <Rows rows={form.operator} />
        <Text style={s.h2}>Détenteur de l&apos;équipement</Text>
        <Rows rows={form.holder} />
        {form.systems.map((sys) => (
          <View key={sys.tag}>
            <Text style={s.h2}>Équipement {sys.tag}</Text>
            <Rows rows={sys.rows} />
          </View>
        ))}
        <Text style={s.h2}>Intervention</Text>
        <Rows rows={form.intervention} />
        {form.notes.map((n) => (
          <Text key={n} style={{ marginTop: 6 }}>
            {clean(n)}
          </Text>
        ))}
        <View style={[s.boxes, { marginTop: 14 }]} wrap={false}>
          <View style={[s.sign, { minHeight: 80 }]}>
            <Text style={s.label}>Signature de l&apos;opérateur</Text>
          </View>
          <View style={[s.sign, { minHeight: 80 }]}>
            <Text style={s.label}>Signature du détenteur</Text>
          </View>
        </View>
      </Page>
    </Document>
  );
}

// ---------------------------------------------------------------------------
// Avenant au devis
// ---------------------------------------------------------------------------
export function AmendmentPdf({ amendment, company, client, quoteNumber, date, quoteTotalTtcCents }: { amendment: Amendment; company: PdfParty; client: PdfParty; quoteNumber: string; date: string; quoteTotalTtcCents: number }) {
  const qty = (n: number) => clean(n.toLocaleString("fr-FR", { maximumFractionDigits: 2 }));
  return (
    <Document title={`Avenant ${amendment.number} au devis ${quoteNumber}`} author={company.name} subject="Avenant au devis" language="fr-FR">
      <Page size="A4" style={s.page}>
        <Footer left={company.name} right={`Avenant n° ${amendment.number} au devis ${quoteNumber}`} />
        <Text style={s.title}>AVENANT N° {amendment.number}</Text>
        <Text>
          au devis n° {quoteNumber} · établi le {date}
        </Text>
        <Parties company={company} client={client} />
        <Text style={{ marginTop: 10 }}>Travaux supplémentaires rendus nécessaires en cours de chantier. Les autres conditions du devis restent inchangées.</Text>

        <View style={[s.th, { marginTop: 10 }]}>
          <Text style={{ flex: 1 }}>Désignation</Text>
          <Text style={{ width: 55, textAlign: "right" }}>Qté</Text>
          <Text style={{ width: 70, textAlign: "right" }}>PU HT</Text>
          <Text style={{ width: 75, textAlign: "right" }}>Total HT</Text>
        </View>
        {amendment.items.map((it, i) => (
          <View key={i}>
            <View style={[s.tr, { backgroundColor: C.light }]} wrap={false}>
              <Text style={[s.bold, { flex: 1 }]}>{clean(it.description)}</Text>
            </View>
            {it.lines.map((l, j) => (
              <View key={j} style={s.tr} wrap={false}>
                <Text style={{ flex: 1, paddingLeft: 8 }}>{clean(l.designation)}</Text>
                <Text style={{ width: 55, textAlign: "right" }}>
                  {qty(l.quantity)} {l.unit === "u" ? "" : l.unit}
                </Text>
                <Text style={{ width: 70, textAlign: "right" }}>{pdfEuros(l.unitSaleCents)}</Text>
                <Text style={{ width: 75, textAlign: "right" }}>{pdfEuros(Math.round(l.quantity * l.unitSaleCents))}</Text>
              </View>
            ))}
          </View>
        ))}
        <View style={{ alignSelf: "flex-end", width: 250, marginTop: 8 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <Text>Total avenant HT</Text>
            <Text>{pdfEuros(amendment.totalHtCents)}</Text>
          </View>
          {amendment.vat.map((v) => (
            <View key={v.rate} style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <Text>TVA {clean((v.rate * 100).toLocaleString("fr-FR"))} %</Text>
              <Text>{pdfEuros(v.vatCents)}</Text>
            </View>
          ))}
          <View style={{ flexDirection: "row", justifyContent: "space-between", backgroundColor: C.light, padding: 5, marginTop: 3 }}>
            <Text style={s.bold}>Total avenant {amendment.vatMention ? "" : "TTC"}</Text>
            <Text style={s.bold}>{pdfEuros(amendment.totalTtcCents)}</Text>
          </View>
          {amendment.vatMention && <Text style={[s.muted, { fontSize: 8 }]}>{amendment.vatMention}</Text>}
          <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 6 }}>
            <Text>Devis initial</Text>
            <Text>{pdfEuros(quoteTotalTtcCents)}</Text>
          </View>
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <Text style={s.bold}>Nouveau montant du marché</Text>
            <Text style={s.bold}>{pdfEuros(amendment.newTotalTtcCents)}</Text>
          </View>
        </View>
        <Text style={[s.muted, { marginTop: 10 }]}>Le montant de l&apos;avenant est payable avec le solde du devis.</Text>
        <View style={[s.boxes, { marginTop: 14 }]} wrap={false}>
          <View style={s.sign}>
            <Text style={s.label}>L&apos;entreprise</Text>
            <Text>{clean(company.name)}</Text>
          </View>
          <View style={s.sign}>
            <Text style={s.label}>Le client – bon pour accord</Text>
            <Text style={s.muted}>Date et signature précédées de « Bon pour accord »</Text>
          </View>
        </View>
      </Page>
    </Document>
  );
}
