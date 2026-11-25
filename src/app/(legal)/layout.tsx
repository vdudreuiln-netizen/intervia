import Link from "next/link";
import { LegalFooter } from "@/components/LegalFooter";
import { LEGAL_VERSION } from "@/lib/legal/editor";

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-white">
      <header className="border-b-2 border-slate-200">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4">
          <Link href="/" className="text-xl font-extrabold text-brand">
            ClimDevis
          </Link>
          <Link href="/connexion" className="text-base font-bold text-brand underline">
            Connexion
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-8">
        <article className="legal space-y-4 text-base leading-relaxed [&_h1]:text-3xl [&_h1]:font-extrabold [&_h2]:mt-8 [&_h2]:text-xl [&_h2]:font-bold [&_li]:ml-5 [&_li]:list-disc">{children}</article>
        <p className="mt-10 text-sm text-slate-500">Version du {LEGAL_VERSION.split("-").reverse().join("/")}</p>
      </main>
      <LegalFooter />
    </div>
  );
}
