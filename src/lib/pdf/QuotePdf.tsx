/**
 * Rendu PDF du devis (A4) avec @react-pdf/renderer, côté serveur.
 * Ne reçoit que le modèle `QuoteDocument` : aucune donnée de marge possible.
 */
import { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { QuoteDocument } from "./document";
import { WITHDRAWAL_FORM_TEXT } from "./document";
import { PlanPages, SpecPage } from "@/lib/plans/PlanPdf";
import type { PlanAnnex } from "@/lib/plans/annex";
import type { SpecSection } from "@/lib/plans/spec";

/** Annexes du devis (version CLIENT) : plan d'implantation et cahier des charges, sans prix. */
export interface QuoteAnnexes {
  plans: PlanAnnex[];
  spec: SpecSection[] | null;
}

/** Montants pour la police Helvetica (pas d'espace fine insécable). */
export function pdfEuros(cents: number): string {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(cents / 100).replace(/[  ]/g, " ");
}
const pdfRate = (r: number) => `${(Math.round(r * 1000) / 10).toLocaleString("fr-FR")} %`.replace(/[  ]/g, " ");
const clean = (s: string) => s.replace(/[  ]/g, " ").replace(/[≥]/g, ">=").replace(/[→]/g, "->");

const C = { ink: "#111827", muted: "#4B5563", line: "#D1D5DB", brand: "#0B4F8A", light: "#E6F0FA", red: "#B91C1C" };

const s = StyleSheet.create({
  page: { paddingTop: 32, paddingBottom: 64, paddingHorizontal: 36, fontSize: 9.5, color: C.ink, fontFamily: "Helvetica", lineHeight: 1.35 },
  warning: { backgroundColor: C.red, color: "white", padding: 8, marginBottom: 10, fontFamily: "Helvetica-Bold", fontSize: 10 },
  header: { flexDirection: "row", justifyContent: "space-between", marginBottom: 18 },
  logo: { maxWidth: 140, maxHeight: 60, marginBottom: 6, objectFit: "contain" },
  companyName: { fontSize: 13, fontFamily: "Helvetica-Bold" },
  muted: { color: C.muted },
  titleBox: { alignItems: "flex-end" },
  title: { fontSize: 22, fontFamily: "Helvetica-Bold", color: C.brand, letterSpacing: 1, lineHeight: 1.1, marginBottom: 6 },
  parties: { flexDirection: "row", gap: 12, marginBottom: 16 },
  party: { flex: 1, borderWidth: 1, borderColor: C.line, borderRadius: 4, padding: 8 },
  partyLabel: { fontSize: 8, color: C.muted, textTransform: "uppercase", marginBottom: 3, fontFamily: "Helvetica-Bold" },
  bold: { fontFamily: "Helvetica-Bold" },
  thead: { flexDirection: "row", backgroundColor: C.brand, color: "white", paddingVertical: 5, paddingHorizontal: 6, fontFamily: "Helvetica-Bold", fontSize: 8.5 },
  row: { flexDirection: "row", paddingVertical: 5, paddingHorizontal: 6, borderBottomWidth: 0.5, borderBottomColor: C.line },
  cDesig: { flex: 1, paddingRight: 6 },
  cQty: { width: 50, textAlign: "right" },
  cPu: { width: 64, textAlign: "right" },
  cVat: { width: 38, textAlign: "right" },
  cTot: { width: 70, textAlign: "right" },
  detail: { fontSize: 8, color: C.muted, marginTop: 1 },
  totals: { alignSelf: "flex-end", width: 240, marginTop: 8 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 },
  grand: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 5, paddingHorizontal: 6, backgroundColor: C.light, marginTop: 3, fontFamily: "Helvetica-Bold", fontSize: 11 },
  section: { marginTop: 12 },
  sectionTitle: { fontFamily: "Helvetica-Bold", fontSize: 10, marginBottom: 3, color: C.brand },
  legal: { fontSize: 7.8, color: C.muted, marginBottom: 2 },
  signRow: { flexDirection: "row", gap: 12, marginTop: 14 },
  signBox: { flex: 1, borderWidth: 1, borderColor: C.ink, borderRadius: 4, padding: 8, minHeight: 110 },
  stamp: { maxWidth: 140, maxHeight: 70, marginTop: 6, objectFit: "contain" },
  footer: { position: "absolute", bottom: 22, left: 36, right: 36, borderTopWidth: 0.5, borderTopColor: C.line, paddingTop: 5, fontSize: 7.5, color: C.muted, flexDirection: "row", justifyContent: "space-between" },
  cut: { textAlign: "center", color: C.muted, marginVertical: 10, fontSize: 8 },
  field: { borderBottomWidth: 0.5, borderBottomColor: C.ink, height: 22, marginBottom: 4 },
});

export type PdfImage = { data: Buffer; format: "png" | "jpg" } | null;

export function QuotePdf({ doc, logo, stamp, annexes }: { doc: QuoteDocument; logo: PdfImage; stamp: PdfImage; annexes?: QuoteAnnexes | null }) {
  const annexFooter = { left: doc.company.name, right: `Devis ${doc.number} – annexe` };
  const annexPlans = annexes?.plans.filter((p) => p.markers.length > 0) ?? [];
  const detailed = doc.presentation === "detaille";
  const t = doc.totals;
  return (
    <Document title={`Devis ${doc.number}`} author={doc.company.name} subject="Devis climatisation" language="fr-FR">
      <Page size="A4" style={s.page}>
        <View style={s.footer} fixed>
          <Text>
            {doc.bank ? clean(`RIB : ${doc.bank.holder} · IBAN ${doc.bank.iban}${doc.bank.bic ? ` · BIC ${doc.bank.bic}` : ""}`) : clean(doc.company.name)}
          </Text>
          <Text>Devis {doc.number}</Text>
        </View>
        {doc.warnings.map((w) => (
          <Text key={w} style={s.warning}>
            {clean(w)}
          </Text>
        ))}

        <View style={s.header}>
          <View style={{ maxWidth: 300 }}>
            {logo && <Image style={s.logo} src={logo} />}
            <Text style={s.companyName}>{clean(doc.company.name)}</Text>
            {doc.company.lines.map((l) => (
              <Text key={l} style={s.muted}>
                {clean(l)}
              </Text>
            ))}
          </View>
          <View style={s.titleBox}>
            <Text style={s.title}>DEVIS</Text>
            <Text style={s.bold}>N° {doc.number}</Text>
            <Text>Date : {doc.issueDate}</Text>
            <Text>Valable jusqu&apos;au : {doc.validUntil}</Text>
          </View>
        </View>

        <View style={s.parties}>
          <View style={s.party}>
            <Text style={s.partyLabel}>Client</Text>
            {doc.client.map((l, i) => (
              <Text key={i} style={i === 0 ? s.bold : undefined}>
                {clean(l)}
              </Text>
            ))}
          </View>
          {doc.site && (
            <View style={s.party}>
              <Text style={s.partyLabel}>Adresse du chantier</Text>
              {doc.site.map((l) => (
                <Text key={l}>{clean(l)}</Text>
              ))}
            </View>
          )}
        </View>

        <View style={s.thead}>
          <Text style={s.cDesig}>Désignation</Text>
          {detailed && <Text style={s.cQty}>Qté</Text>}
          {detailed && <Text style={s.cPu}>PU HT</Text>}
          {doc.showVat && <Text style={s.cVat}>TVA</Text>}
          <Text style={s.cTot}>Total HT</Text>
        </View>
        {doc.items.map((it, i) => (
          <View key={i} style={s.row} wrap={false}>
            <View style={s.cDesig}>
              <Text style={detailed ? undefined : s.bold}>{clean(it.designation)}</Text>
              {it.details?.map((d, j) => (
                <Text key={j} style={s.detail}>
                  {clean(`• ${d}`)}
                </Text>
              ))}
              {!detailed && it.quantity && <Text style={s.detail}>Quantité : {clean(it.quantity)}</Text>}
            </View>
            {detailed && <Text style={s.cQty}>{clean(it.quantity ?? "")}</Text>}
            {detailed && <Text style={s.cPu}>{it.unitPriceCents === undefined ? "" : pdfEuros(it.unitPriceCents)}</Text>}
            {doc.showVat && <Text style={s.cVat}>{it.vatRate === null ? "multi" : it.vatRate === undefined ? "" : pdfRate(it.vatRate)}</Text>}
            <Text style={s.cTot}>{it.totalCents === null ? "Inclus" : pdfEuros(it.totalCents)}</Text>
          </View>
        ))}

        <View style={s.totals} wrap={false}>
          {t.discount && (
            <>
              <View style={s.totalRow}>
                <Text>Total HT avant remise</Text>
                <Text>{pdfEuros(t.grossHtCents!)}</Text>
              </View>
              <View style={s.totalRow}>
                <Text style={s.bold}>{clean(t.discount.label)}</Text>
                <Text style={s.bold}>- {pdfEuros(t.discount.cents)}</Text>
              </View>
            </>
          )}
          <View style={s.totalRow}>
            <Text style={s.bold}>Total HT</Text>
            <Text style={s.bold}>{pdfEuros(t.htCents)}</Text>
          </View>
          {t.vat.map((v) => (
            <View key={v.rate} style={s.totalRow}>
              <Text>
                TVA {pdfRate(v.rate)} sur {pdfEuros(v.baseCents)}
              </Text>
              <Text>{pdfEuros(v.vatCents)}</Text>
            </View>
          ))}
          <View style={s.grand}>
            <Text>{t.ttcCents === null ? "Net à payer" : "Total TTC"}</Text>
            <Text>{pdfEuros(t.toPayCents)}</Text>
          </View>
          {t.vatMention && <Text style={[s.legal, { marginTop: 3 }]}>{t.vatMention}</Text>}
        </View>

        <View style={s.section} wrap={false}>
          <Text style={s.sectionTitle}>Paiement</Text>
          {doc.payments.map((p) => (
            <View key={p.label} style={s.totalRow}>
              <Text>{clean(p.label)}</Text>
              <Text style={s.bold}>{pdfEuros(p.cents)}</Text>
            </View>
          ))}
          {doc.paymentNote && <Text style={s.legal}>{clean(doc.paymentNote)}</Text>}
          {doc.paymentTerms && <Text style={[s.legal, { marginTop: 2 }]}>{clean(doc.paymentTerms)}</Text>}
        </View>

        <View style={s.section} wrap={false}>
          <Text style={s.sectionTitle}>Mentions</Text>
          {doc.legal.map((l, i) => (
            <Text key={i} style={s.legal}>
              {clean(l)}
            </Text>
          ))}
        </View>

        <View style={s.signRow} wrap={false}>
          <View style={s.signBox}>
            <Text style={s.partyLabel}>L&apos;entreprise</Text>
            <Text>{clean(doc.company.name)}</Text>
            {stamp && <Image style={s.stamp} src={stamp} />}
          </View>
          <View style={s.signBox}>
            <Text style={s.partyLabel}>Le client — bon pour accord</Text>
            <Text style={s.legal}>Date, puis signature précédée de la mention manuscrite :</Text>
            <Text style={s.bold}>« {doc.signatureMention} »</Text>
            <Text style={{ marginTop: 8 }}>Date : ____ / ____ / ________</Text>
          </View>
        </View>

        {doc.earlyStartRequest && (
          <View style={[s.section, { borderWidth: 1, borderColor: C.ink, padding: 8, borderRadius: 4 }]} wrap={false}>
            <Text style={s.bold}>[   ] Demande de démarrage des travaux avant la fin du délai de rétractation</Text>
            <Text style={[s.legal, { color: C.ink, marginTop: 3 }]}>{clean(doc.earlyStartRequest)}</Text>
            <Text style={{ marginTop: 6 }}>Signature du client :</Text>
          </View>
        )}

      </Page>

      {doc.withdrawalForm && (
        <Page size="A4" style={s.page}>
          <View style={s.footer} fixed>
            <Text>{clean(doc.company.name)}</Text>
            <Text>Devis {doc.number}</Text>
          </View>
          <Text style={s.cut}>- - - - - - - - - - - - - - - - - - - -  À découper ou à recopier  - - - - - - - - - - - - - - - - - - - -</Text>
          <Text style={[s.title, { fontSize: 16, marginBottom: 10 }]}>Formulaire de rétractation</Text>
          <Text style={s.legal}>(Devis n° {doc.number} du {doc.issueDate} — délai de 14 jours à compter de la signature)</Text>
          <Text style={{ marginTop: 8 }}>{WITHDRAWAL_FORM_TEXT[0]}</Text>
          <Text style={{ marginTop: 8 }}>
            À l&apos;attention de : {clean(doc.company.name)}, {clean(doc.company.lines.slice(0, 3).join(", "))}
          </Text>
          <Text style={{ marginTop: 8 }}>{WITHDRAWAL_FORM_TEXT[1]}</Text>
          {["Commandé le (*) :", "Nom du (des) consommateur(s) :", "Adresse du (des) consommateur(s) :", "", "Signature du (des) consommateur(s) (uniquement en cas de notification du présent formulaire sur papier) :", "", "Date :"].map((label, i) => (
            <View key={i} style={{ marginTop: 6 }}>
              {label && <Text>{label}</Text>}
              <View style={s.field} />
            </View>
          ))}
          <Text style={s.legal}>(*) Rayez la mention inutile.</Text>
        </Page>
      )}
      {annexes && annexPlans.length > 0 && <PlanPages plans={annexPlans} title="Annexe 1 – Plan d'implantation" footer={annexFooter} />}
      {annexes?.spec && (
        <SpecPage
          title={`Annexe ${annexPlans.length ? 2 : 1} – Cahier des charges`}
          sections={annexes.spec}
          footer={annexFooter}
          note="Ce cahier des charges fait partie du devis. Les emplacements définitifs sont confirmés avec vous avant le début des travaux."
        />
      )}
    </Document>
  );
}
