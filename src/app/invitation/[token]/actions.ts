"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function joinCompany(token: string, password: string): Promise<{ ok: false; message: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Connectez-vous d'abord." };
  if (password) {
    if (password.length < 8) return { ok: false, message: "Mot de passe trop court : 8 caractères minimum." };
    const { error } = await supabase.auth.updateUser({ password });
    if (error) return { ok: false, message: "Impossible d'enregistrer le mot de passe." };
  }
  const { error } = await supabase.rpc("accept_invitation", { p_token: token });
  if (error) return { ok: false, message: error.message };
  redirect("/app");
}
