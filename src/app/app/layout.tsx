import Link from "next/link";
import { getCurrentCompany } from "@/lib/company/current";
import { signOut } from "@/app/connexion/actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { company } = await getCurrentCompany();
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
      <main className="mx-auto max-w-3xl px-4 py-6">{children}</main>
      {company.onboarding_done && (
        <nav className="fixed inset-x-0 bottom-0 z-10 border-t-2 border-slate-300 bg-white" aria-label="Navigation principale">
          <div className="mx-auto grid max-w-3xl grid-cols-2">
            <Link href="/app" className="flex min-h-16 flex-col items-center justify-center text-base font-bold text-brand">
              <span aria-hidden className="text-2xl">📋</span>Devis
            </Link>
            <Link href="/app/parametres" className="flex min-h-16 flex-col items-center justify-center text-base font-bold text-brand">
              <span aria-hidden className="text-2xl">⚙️</span>Paramètres
            </Link>
          </div>
        </nav>
      )}
    </div>
  );
}
