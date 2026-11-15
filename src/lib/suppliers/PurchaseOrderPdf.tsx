/**
 * Bon de commande fournisseur (A4), rendu serveur avec @react-pdf/renderer.
 * Contient les prix NETS attendus : réservé aux membres autorisés. Aucun prix client.
 */
import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { pdfEuros } from "@/lib/pdf/QuotePdf";
import type { PurchaseOrder } from "./orders";

const C = {
  ink: "#111827",
  muted: "#4B5563",
  line: "#D1D5DB",
  brand: "#0B4F8A",
  light: "#E6F0FA",
};
const clean = (v: string) => v.replace(/[  ]/g, " ");
const qty = (n: number) => clean(n.toLocaleString("fr-FR", { maximumFractionDigits: 2 }));
const date = (iso: string) => new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" });

const s = StyleSheet.create({
  page: {
    paddingTop: 32,
    paddingBottom: 56,
    paddingHorizontal: 36,
    fontSize: 9.5,
    color: C.ink,
    fontFamily: "Helvetica",
    lineHeight: 1.35,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  title: {
    fontSize: 20,
    fontFamily: "Helvetica-Bold",
    color: C.brand,
    lineHeight: 1.1,
    marginBottom: 4,
    textAlign: "right",
  },
  bold: { fontFamily: "Helvetica-Bold" },
  muted: { color: C.muted },
  boxes: { flexDirection: "row", gap: 10, marginBottom: 12 },
  box: {
    flex: 1,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 4,
    padding: 8,
  },
  label: {
    fontSize: 8,
    color: C.muted,
    textTransform: "uppercase",
    marginBottom: 3,
    fontFamily: "Helvetica-Bold",
  },
  thead: {
    flexDirection: "row",
    backgroundColor: C.brand,
    color: "white",
    paddingVertical: 5,
    paddingHorizontal: 6,
    fontFamily: "Helvetica-Bold",
    fontSize: 8.5,
  },
  row: {
    flexDirection: "row",
    paddingVertical: 5,
    paddingHorizontal: 6,
    borderBottomWidth: 0.5,
    borderBottomColor: C.line,
  },
  cSup: { width: 78, paddingRight: 4 },
  cMan: { width: 84, paddingRight: 4 },
  cDes: { flex: 1, paddingRight: 4 },
  cQty: { width: 44, textAlign: "right" },
  cPu: { width: 62, textAlign: "right" },
  cTot: { width: 66, textAlign: "right" },
  totals: { alignSelf: "flex-end", width: 220, marginTop: 8 },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 2,
  },
  grand: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 5,
    paddingHorizontal: 6,
    backgroundColor: C.light,
    marginTop: 3,
    fontFamily: "Helvetica-Bold",
    fontSize: 11,
  },
  footer: {
    position: "absolute",
    bottom: 22,
    left: 36,
    right: 36,
    borderTopWidth: 0.5,
    borderTopColor: C.line,
    paddingTop: 5,
    fontSize: 7.5,
    color: C.muted,
    flexDirection: "row",
    justifyContent: "space-between",
  },
});

export interface OrderCompany {
  name: string;
  address: string;
  phone: string | null;
  email: string | null;
  siret: string | null;
}

/** Bon de commande tel qu'enregistré (dates en texte ISO). */
export type StoredPurchaseOrder = Omit<PurchaseOrder, "generatedAt"> & {
  generatedAt: string;
};

export function PurchaseOrderPdf({ order, company }: { order: StoredPurchaseOrder; company: OrderCompany }) {
  const sup = order.supplier;
  return (
    <Document title={`Bon de commande ${order.number}`} author={company.name} subject="Bon de commande fournisseur" language="fr-FR">
      <Page size="A4" style={s.page}>
        <View style={s.header}>
          <View>
            <Text style={[s.bold, { fontSize: 13 }]}>{clean(company.name)}</Text>
            <Text>{clean(company.address)}</Text>
            {company.phone && <Text>Tél. {company.phone}</Text>}
            {company.email && <Text>{company.email}</Text>}
            {company.siret && <Text style={s.muted}>SIRET {company.siret}</Text>}
          </View>
          <View>
            <Text style={s.title}>BON DE COMMANDE</Text>
            <Text style={{ textAlign: "right" }}>N° {order.number}</Text>
            <Text style={{ textAlign: "right" }}>Émis le {date(order.generatedAt)}</Text>
          </View>
        </View>

        <View style={s.boxes}>
          <View style={s.box}>
            <Text style={s.label}>Fournisseur</Text>
            <Text style={s.bold}>{clean(sup.name)}</Text>
            {sup.agency && <Text>Agence : {clean(sup.agency)}</Text>}
            {sup.contactName && <Text>À l&apos;attention de {clean(sup.contactName)}</Text>}
            {sup.phone && <Text>Tél. {sup.phone}</Text>}
            {sup.email && <Text>{sup.email}</Text>}
          </View>
          <View style={s.box}>
            <Text style={s.label}>{order.deliveryLabel}</Text>
            <Text>{clean(order.deliveryAddress || "Adresse à préciser")}</Text>
            <Text style={[s.bold, { marginTop: 4 }]}>Livraison souhaitée : {order.desiredDate ? date(order.desiredDate) : "dès que possible"}</Text>
            <Text style={{ marginTop: 4 }}>Référence chantier : {clean(order.siteReference)}</Text>
          </View>
        </View>

        <View style={s.thead} fixed>
          <Text style={s.cSup}>Réf. fournisseur</Text>
          <Text style={s.cMan}>Réf. fabricant</Text>
          <Text style={s.cDes}>Désignation</Text>
          <Text style={s.cQty}>Qté</Text>
          <Text style={s.cPu}>PU net HT</Text>
          <Text style={s.cTot}>Total HT</Text>
        </View>
        {order.lines.map((l, i) => (
          <View key={i} style={s.row} wrap={false}>
            <Text style={s.cSup}>{clean(l.supplierRef || "—")}</Text>
            <Text style={s.cMan}>{clean(l.manufacturerRef || "—")}</Text>
            <Text style={s.cDes}>{clean(l.designation)}</Text>
            <Text style={s.cQty}>
              {qty(l.quantity)} {l.unit === "u" ? "" : l.unit}
            </Text>
            <Text style={s.cPu}>{pdfEuros(l.unitNetCents)}</Text>
            <Text style={s.cTot}>{pdfEuros(l.totalNetCents)}</Text>
          </View>
        ))}

        <View style={s.totals}>
          <View style={s.totalRow}>
            <Text>Total marchandise HT</Text>
            <Text>{pdfEuros(order.subtotalCents)}</Text>
          </View>
          <View style={s.totalRow}>
            <Text>Frais de port HT (selon vos conditions)</Text>
            <Text>{order.shippingCents ? pdfEuros(order.shippingCents) : "franco"}</Text>
          </View>
          <View style={s.grand}>
            <Text>Total attendu HT</Text>
            <Text>{pdfEuros(order.totalCents)}</Text>
          </View>
        </View>
        <Text style={[s.muted, { marginTop: 14, fontSize: 8.5 }]}>Prix nets attendus selon votre dernier tarif et nos conditions. Merci de nous signaler tout écart avant expédition.</Text>

        <View style={s.footer} fixed>
          <Text>
            {clean(company.name)} · Bon de commande {order.number}
          </Text>
          <Text>Référence chantier : {clean(order.siteReference)}</Text>
        </View>
      </Page>
    </Document>
  );
}
