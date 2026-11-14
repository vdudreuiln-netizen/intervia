"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { LEGAL_VERSION } from "@/lib/legal/editor";

export async function joinCompany(token: string, password: string, termsAccepted: boolean): Promise<{ ok: false; message: string }> {
  if (!termsAccepted) return { ok: false, message: "Acceptez les conditions générales et la politique de confidentialité pour continuer." };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Connectez-vous d'abord." };
  if (password && password.length < 8) return { ok: false, message: "Mot de passe trop court : 8 caractères minimum." };
  const { error: upErr } = await supabase.auth.updateUser({
    ...(password ? { password } : {}),
    data: { terms_version: LEGAL_VERSION, terms_accepted_at: new Date().toISOString() },
  });
  if (upErr) return { ok: false, message: "Impossible d'enregistrer vos informations. Réessayez." };
  const { error } = await supabase.rpc("accept_invitation", { p_token: token });
  if (error) return { ok: false, message: error.message };
  redirect("/app");
}
