/**
 * Pages PDF des plans d'implantation et des cahiers des charges (react-pdf).
 * Aucune donnée de prix n'arrive ici.
 */
import { Circle, Document, Image, Page, Polyline, StyleSheet, Svg, Text, View } from "@react-pdf/renderer";
import { ROUTE_LEGEND, type PlanAnnex } from "./annex";
import type { SiteSpec, SpecSection } from "./spec";

const C = { ink: "#111827", muted: "#4B5563", line: "#D1D5DB", brand: "#0B4F8A", light: "#E6F0FA" };
const clean = (s: string) => s.replace(/[  ]/g, " ").replace(/[→]/g, "->").replace(/[≈]/g, "env.");

const s = StyleSheet.create({
  page: { paddingTop: 28, paddingBottom: 48, paddingHorizontal: 32, fontSize: 9.5, color: C.ink, fontFamily: "Helvetica", lineHeight: 1.35 },
  title: { fontSize: 15, fontFamily: "Helvetica-Bold", color: C.brand, marginBottom: 8 },
  h2: { fontSize: 11, fontFamily: "Helvetica-Bold", color: C.brand, marginTop: 10, marginBottom: 4 },
  item: { flexDirection: "row", marginBottom: 2 },
  bullet: { width: 16 },
  muted: { color: C.muted },
  legend: { flexDirection: "row", flexWrap: "wrap", marginTop: 6 },
  legendItem: { width: "33%", fontSize: 8, marginBottom: 2 },
  tag: { position: "absolute", fontSize: 7, fontFamily: "Helvetica-Bold", color: "white", textAlign: "center" },
  footer: { position: "absolute", bottom: 20, left: 32, right: 32, borderTopWidth: 0.5, borderTopColor: C.line, paddingTop: 4, fontSize: 7.5, color: C.muted, flexDirection: "row", justifyContent: "space-between" },
  th: { flexDirection: "row", backgroundColor: C.brand, color: "white", fontFamily: "Helvetica-Bold", fontSize: 8, paddingVertical: 4, paddingHorizontal: 4 },
  tr: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: C.line, paddingVertical: 4, paddingHorizontal: 4, fontSize: 8.5 },
});

export function Footer({ left, right }: { left: string; right: string }) {
  return (
    <View style={s.footer} fixed>
      <Text>{clean(left)}</Text>
      <Text>{clean(right)}</Text>
    </View>
  );
}

/** Une page A4 paysage par niveau : plan, tracés, repères, légende. */
export function PlanPages({ plans, title, footer }: { plans: PlanAnnex[]; title: string; footer: { left: string; right: string } }) {
  const availW = 842 - 64;
  return (
    <>
      {plans.map((p, i) => {
        // hauteur réservée : titre, ligne du nord, légende sur 3 colonnes (≈ 11 pt par ligne)
        const legendRows = Math.ceil((ROUTE_LEGEND.length + p.legend.length) / 3);
        const availH = 595 - 28 - 48 - 30 - 18 - legendRows * 14 - 24;
        const k = Math.min(availW / p.width, availH / p.height);
        const w = p.width * k;
        const h = p.height * k;
        const r = Math.max(p.width, p.height) / 110;
        return (
          <Page key={i} size="A4" orientation="landscape" style={s.page}>
            <Footer {...footer} />
            <Text style={s.title}>
              {clean(title)} – {clean(p.label)}
            </Text>
            <View style={{ width: w, height: h, position: "relative", borderWidth: 0.5, borderColor: C.line }}>
              <Image src={p.image} style={{ position: "absolute", top: 0, left: 0, width: w, height: h }} />
              <Svg width={w} height={h} viewBox={`0 0 ${p.width} ${p.height}`} style={{ position: "absolute", top: 0, left: 0 }}>
                {p.routes.map((rt, j) => (
                  <Polyline key={j} points={rt.points.map((pt) => `${pt.x},${pt.y}`).join(" ")} fill="none" stroke={rt.color} strokeWidth={r * 0.5} strokeDasharray={rt.dashed ? `${r} ${r / 2}` : undefined} strokeLinejoin="round" strokeLinecap="round" />
                ))}
                {p.markers.map((m, j) => (
                  <Circle key={j} cx={m.x} cy={m.y} r={r * 1.5} fill={m.dark ? "#111827" : "#0B4F8A"} stroke="white" strokeWidth={r / 4} />
                ))}
              </Svg>
              {p.markers.map((m, j) => (
                <Text key={j} style={[s.tag, { left: m.x * k - 10, top: m.y * k - 4.5, width: 20 }]}>
                  {m.tag}
                </Text>
              ))}
            </View>
            {p.northDeg !== null && <Text style={[s.muted, { marginTop: 4 }]}>Nord : {Math.round(p.northDeg)}° (sens horaire depuis le haut du plan).</Text>}
            <View style={s.legend}>
              {ROUTE_LEGEND.map((l) => (
                <Text key={l.label} style={[s.legendItem, { color: l.color }]}>
                  {l.dashed ? "- - -" : "——"} {l.label}
                </Text>
              ))}
              {p.legend.map((l) => (
                <Text key={l} style={s.legendItem}>
                  {clean(l)}
                </Text>
              ))}
            </View>
          </Page>
        );
      })}
    </>
  );
}

export function SpecPage({ title, sections, footer, note }: { title: string; sections: SpecSection[]; footer: { left: string; right: string }; note?: string }) {
  return (
    <Page size="A4" style={s.page}>
      <Footer {...footer} />
      <Text style={s.title}>{clean(title)}</Text>
      {sections.map((sec) => (
        <View key={sec.title} wrap={false}>
          <Text style={s.h2}>{clean(sec.title)}</Text>
          {sec.items.map((it, i) => (
            <View key={i} style={s.item}>
              <Text style={s.bullet}>•</Text>
              <Text style={{ flex: 1 }}>{clean(it)}</Text>
            </View>
          ))}
        </View>
      ))}
      {note && <Text style={[s.muted, { marginTop: 12 }]}>{clean(note)}</Text>}
    </Page>
  );
}

/** Dossier technique CHANTIER : document séparé, sans aucun prix ni marge. */
export function SitePdf({ company, quoteNumber, spec, plans, generatedAt }: { company: string; quoteNumber: string; spec: SiteSpec; plans: PlanAnnex[]; generatedAt: string }) {
  const footer = { left: `${company} · Dossier chantier ${quoteNumber}`, right: `Édité le ${generatedAt}` };
  const cell = (flex: number, align: "left" | "right" = "left") => ({ flex, textAlign: align });
  return (
    <Document title={`Dossier chantier ${quoteNumber}`} author={company} subject="Dossier technique chantier" language="fr-FR">
      <Page size="A4" style={s.page}>
        <Footer {...footer} />
        <Text style={s.title}>Dossier chantier – {clean(quoteNumber)}</Text>
        <Text style={s.muted}>Document interne : aucun prix. À emporter sur le chantier.</Text>
        <Text style={s.h2}>{spec.header.title}</Text>
        {spec.header.items.map((t) => (
          <Text key={t}>{clean(t)}</Text>
        ))}

        <Text style={s.h2}>Unités intérieures</Text>
        <View style={s.th}>
          <Text style={cell(0.5)}>Repère</Text>
          <Text style={cell(1.6)}>Pièce</Text>
          <Text style={cell(1.8)}>Modèle</Text>
          <Text style={cell(1)}>Liaisons</Text>
          <Text style={cell(0.8, "right")}>Liaison</Text>
          <Text style={cell(0.8, "right")}>Condens.</Text>
          <Text style={cell(0.8, "right")}>Goulotte</Text>
          <Text style={cell(0.6, "right")}>Pompe</Text>
        </View>
        {spec.indoors.map((u) => (
          <View key={u.tag} style={s.tr} wrap={false}>
            <Text style={cell(0.5)}>{u.tag}</Text>
            <Text style={cell(1.6)}>{clean(u.where)}</Text>
            <Text style={cell(1.8)}>{clean(u.model)}</Text>
            <Text style={cell(1)}>{clean(u.diameters)}</Text>
            <Text style={cell(0.8, "right")}>{u.linkM.toLocaleString("fr-FR")} m</Text>
            <Text style={cell(0.8, "right")}>{u.condensatsM === null ? "-" : `${u.condensatsM.toLocaleString("fr-FR")} m`}</Text>
            <Text style={cell(0.8, "right")}>{u.goulotteM === null ? "-" : `${u.goulotteM.toLocaleString("fr-FR")} m`}</Text>
            <Text style={cell(0.6, "right")}>{u.pump ? "oui" : "non"}</Text>
          </View>
        ))}

        <Text style={s.h2}>Unités extérieures</Text>
        <View style={s.th}>
          <Text style={cell(0.5)}>Repère</Text>
          <Text style={cell(2)}>Modèle</Text>
          <Text style={cell(1.2)}>Pose</Text>
          <Text style={cell(0.9, "right")}>Câble alim.</Text>
          <Text style={cell(0.9, "right")}>Liaisons</Text>
          <Text style={cell(0.9, "right")}>Pré-chargé</Text>
          <Text style={cell(1, "right")}>Charge compl.</Text>
        </View>
        {spec.outdoors.map((o) => (
          <View key={o.tag} style={s.tr} wrap={false}>
            <Text style={cell(0.5)}>{o.tag}</Text>
            <Text style={cell(2)}>{clean(o.model)}</Text>
            <Text style={cell(1.2)}>{o.support}</Text>
            <Text style={cell(0.9, "right")}>{o.electricM === null ? "-" : `${o.electricM.toLocaleString("fr-FR")} m`}</Text>
            <Text style={cell(0.9, "right")}>{o.totalLinkM.toLocaleString("fr-FR")} m</Text>
            <Text style={cell(0.9, "right")}>{o.prechargedM === null ? "?" : `${o.prechargedM.toLocaleString("fr-FR")} m`}</Text>
            <Text style={cell(1, "right")}>{o.extraChargeG === null ? "à calculer" : `${o.extraChargeG} g`}</Text>
          </View>
        ))}

        <Text style={s.h2}>Matériel à charger</Text>
        {spec.materials.map((m, i) => (
          <View key={i} style={s.item} wrap={false}>
            <Text style={s.bullet}>[  ]</Text>
            <Text style={{ flex: 1 }}>{clean(m.designation)}</Text>
            <Text style={{ width: 70, textAlign: "right" }}>{clean(m.quantity)}</Text>
          </View>
        ))}

        <Text style={s.h2}>{spec.checks.title}</Text>
        {spec.checks.items.map((c) => (
          <View key={c} style={s.item} wrap={false}>
            <Text style={s.bullet}>[  ]</Text>
            <Text style={{ flex: 1 }}>{clean(c)}</Text>
          </View>
        ))}
      </Page>
      <PlanPages plans={plans} title="Plan d'implantation" footer={footer} />
    </Document>
  );
}
