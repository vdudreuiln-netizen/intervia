import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
// @ts-expect-error module JS sans types
import { bundleSql } from "../../scripts/bundle-sql.mjs";

describe("fichier SQL d'installation", () => {
  it("est à jour avec les migrations (lancer « npm run sql:bundle » sinon)", () => {
    expect(readFileSync("supabase/climdevis-installation.sql", "utf8")).toBe(bundleSql());
  });
});
