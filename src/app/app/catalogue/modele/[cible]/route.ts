import { templateCsv } from "@/lib/catalog/import";

/** Modèle CSV à remplir (séparateur « ; », s'ouvre directement dans Excel). */
export async function GET(_req: Request, { params }: { params: Promise<{ cible: string }> }) {
  const { cible } = await params;
  const target = cible === "accessoires" ? "accessoires" : "materiel";
  return new Response(templateCsv(target), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="modele-${target}-climdevis.csv"`,
    },
  });
}
