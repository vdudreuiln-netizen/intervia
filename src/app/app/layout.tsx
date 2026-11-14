import Link from "next/link";
import { getCurrentCompany } from "@/lib/company/current";
import { signOut } from "@/app/connexion/actions";
import { loadBilling } from "@/lib/billing/load";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { company, supabase, role } = await getCurrentCompany();
  const { access } = await loadBilling(supabase);
  const isAdmin = role === "admin";
  return (
    <div className="min-h-dvh pb-24">
      <header className="sticky top-0 z-10 border-b-2 border-brand-dark bg-brand text-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
          <Link href="/app" className="truncate text-lg font-extrabold">
            {company.legal_name}
          </Link>
          <form action={signOut}>
            <button className="min-h-12 rounded-lg px-3 text-base font-bold underline underline-offset-4">Déconnexion</button>
          </form>
        </div>
      </header>
      {access.message && (access.mode !== "active" || access.message) && (
        <div className={`border-b-2 px-4 py-3 text-center text-base font-bold ${access.canWrite && access.mode !== "past_due" ? "border-brand bg-brand-light text-brand-dark" : "border-danger bg-danger-light text-danger"}`} role="status">
          {access.message}{" "}
          {isAdmin && (
            <Link href="/app/abonnement" className="underline">
              {access.mode === "trial" ? "Voir les formules" : "Gérer l'abonnement"}
            </Link>
          )}
        </div>
      )}
      <main className="mx-auto max-w-3xl px-4 py-6">{children}</main>
      {company.onboarding_done && (
        <nav className="fixed inset-x-0 bottom-0 z-10 border-t-2 border-slate-300 bg-white" aria-label="Navigation principale">
          <div className={`mx-auto grid max-w-3xl ${isAdmin ? "grid-cols-3" : "grid-cols-2"}`}>
            <Link href="/app" className="flex min-h-16 flex-col items-center justify-center text-base font-bold text-brand">
              <span aria-hidden className="text-2xl">📋</span>Devis
            </Link>
            <Link href="/app/catalogue" className="flex min-h-16 flex-col items-center justify-center text-base font-bold text-brand">
              <span aria-hidden className="text-2xl">📦</span>Catalogue
            </Link>
            {isAdmin && (
              <Link href="/app/parametres" className="flex min-h-16 flex-col items-center justify-center text-base font-bold text-brand">
                <span aria-hidden className="text-2xl">⚙️</span>Paramètres
              </Link>
            )}
          </div>
        </nav>
      )}
    </div>
  );
}
