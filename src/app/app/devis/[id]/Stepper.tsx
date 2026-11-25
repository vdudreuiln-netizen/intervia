import Link from "next/link";

export const STEP_LABELS = ["Client", "Pièces", "Puissances", "Solutions", "Métré", "Main d'œuvre"];

/** Fil des étapes : chiffres cliquables pour revenir en arrière. */
export function Stepper({ current, quoteId, maxReached = current }: { current: number; quoteId: string | null; maxReached?: number }) {
  return (
    <nav aria-label="Étapes du devis">
      <ol className="grid grid-cols-6 gap-1">
        {STEP_LABELS.map((label, i) => {
          const n = i + 1;
          const done = n < current;
          const active = n === current;
          const reachable = quoteId !== null && n <= maxReached && !active;
          const box = (
            <span className={`flex h-11 items-center justify-center rounded-lg text-lg font-extrabold ${active ? "bg-brand text-white" : done ? "bg-brand-light text-brand" : "bg-slate-200 text-slate-500"}`}>{done ? "✓" : n}</span>
          );
          return (
            <li key={label} className="text-center">
              {reachable ? (
                <Link href={`/app/devis/${quoteId}?etape=${n}`} aria-label={`Étape ${n} : ${label}`}>
                  {box}
                </Link>
              ) : (
                box
              )}
              <span className={`mt-1 block truncate text-xs ${active ? "font-bold text-brand" : "text-slate-600"}`}>{label}</span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
