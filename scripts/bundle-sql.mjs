// Regroupe les migrations dans un seul fichier à coller dans l'éditeur SQL de Supabase.
// Usage : npm run sql:bundle
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function bundleSql(dir = "supabase/migrations") {
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const header = [
    "-- =============================================================================",
    "-- ClimDevis — installation complète de la base (à coller en une fois dans",
    "-- Supabase › SQL Editor › New query, puis « Run »). À exécuter UNE SEULE FOIS",
    "-- sur un projet neuf. Fichier généré par `npm run sql:bundle` : ne pas modifier",
    "-- à la main, modifiez les fichiers de supabase/migrations/.",
    "-- =============================================================================",
    "",
  ].join("\n");
  const body = files.map((f) => `-- >>>>> ${f}\n${readFileSync(join(dir, f), "utf8").trim()}\n`).join("\n");
  return `${header}${body}`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  writeFileSync("supabase/climdevis-installation.sql", bundleSql());
  console.log("supabase/climdevis-installation.sql généré");
}
