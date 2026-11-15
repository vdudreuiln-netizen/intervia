import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { LinkButton, Notice } from "@/components/ui";
import { JoinForm } from "./JoinForm";

export const metadata: Metadata = { title: "Invitation" };

export default async function InvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = await createClient();
  const [{ data: rows }, { data: { user } }] = await Promise.all([supabase.rpc("invitation_preview", { p_token: token }), supabase.auth.getUser()]);
  const inv = (rows as { company_name: string; email: string; access_role: string; expired: boolean; accepted: boolean }[] | null)?.[0];

  return (
    <main className="mx-auto max-w-md space-y-6 px-4 py-10">
      <p className="text-lg font-bold text-brand">ClimDevis</p>
      {!inv ? (
        <Notice tone="danger">Invitation introuvable. Demandez un nouveau lien à votre administrateur.</Notice>
      ) : inv.accepted ? (
        <>
          <Notice tone="ok">Invitation déjà acceptée.</Notice>
          <LinkButton href="/app" full>
            Ouvrir ClimDevis
          </LinkButton>
        </>
      ) : inv.expired ? (
        <Notice tone="danger">Invitation expirée. Demandez un nouveau lien à votre administrateur.</Notice>
      ) : (
        <>
          <h1 className="text-3xl font-extrabold">Rejoindre {inv.company_name}</h1>
          <p className="text-lg">
            Vous êtes invité(e) comme <strong>{inv.access_role === "admin" ? "administrateur" : "technicien"}</strong> ({inv.email}).
          </p>
          {!user ? (
            <div className="space-y-3">
              <LinkButton href={`/connexion?mode=inscription&invitation=${token}&email=${encodeURIComponent(inv.email)}`} full>
                Créer mon compte
              </LinkButton>
              <LinkButton href={`/connexion?invitation=${token}&email=${encodeURIComponent(inv.email)}`} variant="secondary" full>
                J&apos;ai déjà un compte
              </LinkButton>
            </div>
          ) : user.email?.toLowerCase() !== inv.email.toLowerCase() ? (
            <Notice tone="danger">
              Vous êtes connecté(e) avec {user.email}, mais l&apos;invitation est destinée à {inv.email}. Déconnectez-vous puis reconnectez-vous avec la bonne adresse.
            </Notice>
          ) : (
            <JoinForm token={token} askPassword={user.user_metadata?.invitation_token === token} />
          )}
        </>
      )}
    </main>
  );
}
