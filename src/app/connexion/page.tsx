import type { Metadata } from "next";
import { AuthForm } from "./AuthForm";

export const metadata: Metadata = { title: "Connexion" };

export default async function ConnexionPage({ searchParams }: { searchParams: Promise<{ mode?: string; erreur?: string }> }) {
  const { mode, erreur } = await searchParams;
  return (
    <main className="mx-auto max-w-md px-4 py-10">
      {erreur && <p role="alert" className="mb-4 rounded-xl border-2 border-danger bg-danger-light p-4 font-bold text-danger">Le lien de connexion a expiré. Reconnectez-vous.</p>}
      <AuthForm initialMode={mode === "inscription" ? "inscription" : "connexion"} />
    </main>
  );
}
