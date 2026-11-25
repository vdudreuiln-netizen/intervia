import "server-only";
import { getCurrentCompany } from "@/lib/company/current";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Accès aux données de coûts (prix d'achat, remises, marges).
 *  - membre autorisé (administrateur, ou technicien avec l'option) : client normal, RLS appliquée ;
 *  - technicien sans l'option : la base lui refuse ces tables ; le SERVEUR les lit pour lui
 *    avec la clé service, TOUJOURS filtrée sur son entreprise (`companyId`), et ne renvoie
 *    au navigateur que des données nettoyées (voir src/lib/quote/sanitize.ts).
 */
export async function costAccess() {
  const ctx = await getCurrentCompany();
  const restricted = !ctx.canSeeMargins;
  const db = restricted ? createAdminClient() : ctx.supabase;
  if (restricted && !ctx.company.accessory_purchase_coefficient) {
    // Valeur réelle pour les calculs SERVEUR uniquement (l'objet entreprise est propre à la requête).
    // Ne jamais la transmettre au navigateur : les pages envoient des données nettoyées.
    const { data } = await db.from("companies").select("accessory_purchase_coefficient").eq("id", ctx.company.id).single();
    ctx.company.accessory_purchase_coefficient = Number(data?.accessory_purchase_coefficient ?? 2);
  }
  return { ...ctx, db, restricted, companyId: ctx.company.id };
}
