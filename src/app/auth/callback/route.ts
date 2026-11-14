import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Lien de confirmation d'e-mail Supabase → ouverture de session. */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  // destination interne uniquement (pas de redirection ouverte)
  const next = searchParams.get("next");
  const safeNext = next && /^\/invitation\/[0-9a-f]{16,128}$/.test(next) ? next : "/app/bienvenue";
  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${safeNext}`);
  }
  return NextResponse.redirect(`${origin}/connexion?erreur=lien`);
}
