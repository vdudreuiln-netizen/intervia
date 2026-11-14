import "server-only";
import { getCurrentCompany } from "@/lib/company/current";
import { loadBilling } from "./load";

export const READ_ONLY_MESSAGE = "Votre essai est terminé ou votre abonnement est inactif : vos devis restent consultables, abonnez-vous pour les modifier (menu Abonnement).";

/** Message d'erreur si l'entreprise est en lecture seule (sinon null). La base refuse de toute façon. */
export async function readOnlyError(): Promise<{ ok: false; message: string } | null> {
  const { supabase } = await getCurrentCompany();
  const { access } = await loadBilling(supabase);
  return access.canWrite ? null : { ok: false, message: READ_ONLY_MESSAGE };
}

/** Message d'erreur si l'utilisateur n'est pas administrateur (sinon null). */
export async function adminOnlyError(): Promise<{ ok: false; message: string } | null> {
  const { role } = await getCurrentCompany();
  return role === "admin" ? null : { ok: false, message: "Réservé aux administrateurs du compte." };
}
