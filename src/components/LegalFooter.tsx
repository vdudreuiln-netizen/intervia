import Link from "next/link";

export function LegalFooter() {
  return (
    <footer className="border-t-2 border-slate-200 bg-slate-50">
      <nav className="mx-auto flex max-w-5xl flex-wrap gap-x-6 gap-y-2 px-4 py-6 text-base" aria-label="Informations légales">
        <Link href="/mentions-legales" className="underline">Mentions légales</Link>
        <Link href="/cgv" className="underline">CGV / CGU</Link>
        <Link href="/confidentialite" className="underline">Confidentialité</Link>
        <Link href="/dpa" className="underline">Traitement des données (DPA)</Link>
        <Link href="/tarifs" className="underline">Tarifs</Link>
      </nav>
    </footer>
  );
}
