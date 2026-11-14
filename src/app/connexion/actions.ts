"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";

export interface AuthState {
  error?: string;
  info?: string;
}

function translate(message: string): string {
  if (/invalid login credentials/i.test(message)) return "E-mail ou mot de passe incorrect.";
  if (/email not confirmed/i.test(message)) return "Confirmez d'abord votre adresse e-mail (lien reçu par e-mail).";
  if (/already registered/i.test(message)) return "Un compte existe déjà avec cet e-mail. Connectez-vous.";
  if (/password/i.test(message)) return "Mot de passe trop faible : 8 caractères minimum.";
  return "Une erreur est survenue. Réessayez dans un instant.";
}

export async function signIn(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "Indiquez votre e-mail et votre mot de passe." };
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: translate(error.message) };
  redirect("/app");
}

export async function signUp(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const legalName = String(formData.get("legal_name") ?? "").trim();
  if (!legalName) return { error: "Indiquez le nom de votre entreprise." };
  if (!email) return { error: "Indiquez votre e-mail." };
  if (password.length < 8) return { error: "Mot de passe trop court : 8 caractères minimum." };

  const origin = process.env.NEXT_PUBLIC_APP_URL ?? (await headers()).get("origin") ?? "";
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { legal_name: legalName }, emailRedirectTo: `${origin}/auth/callback` },
  });
  if (error) return { error: translate(error.message) };
  if (data.session) redirect("/app/bienvenue");
  return { info: `C'est presque fini : cliquez sur le lien envoyé à ${email} pour activer votre compte.` };
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}
