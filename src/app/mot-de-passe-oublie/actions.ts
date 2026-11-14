"use server";

import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";

export async function requestReset(_prev: { done?: boolean; error?: string }, formData: FormData): Promise<{ done?: boolean; error?: string }> {
  const email = String(formData.get("email") ?? "").trim();
  if (!email) return { error: "Indiquez votre e-mail." };
  const origin = process.env.NEXT_PUBLIC_APP_URL ?? (await headers()).get("origin") ?? "";
  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${origin}/auth/callback?next=/nouveau-mot-de-passe` });
  // Même réponse que le compte existe ou non (pas de divulgation des adresses inscrites)
  return { done: true };
}

export async function setNewPassword(_prev: { error?: string; done?: boolean }, formData: FormData): Promise<{ error?: string; done?: boolean }> {
  const password = String(formData.get("password") ?? "");
  if (password.length < 8) return { error: "Mot de passe trop court : 8 caractères minimum." };
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: "Lien expiré : refaites une demande de mot de passe." };
  return { done: true };
}
