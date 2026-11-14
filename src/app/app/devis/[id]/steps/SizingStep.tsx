"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button, Card, Field, Notice } from "@/components/ui";
import { sizeRoom, type SizingCoefficients } from "@/lib/sizing/sizing";
import type { RoomForm } from "@/lib/quote/rooms";
import { parseDecimal } from "@/lib/format";
import { saveRooms } from "../../actions";

/** Étape 3 : besoin par pièce avec le détail du calcul ; l'artisan peut forcer une valeur. */
export function SizingStep({ quoteId, rooms: initial, gainableAccess, sizing }: { quoteId: string; rooms: RoomForm[]; gainableAccess: boolean; sizing: SizingCoefficients }) {
  const router = useRouter();
  const [rooms, setRooms] = useState(initial);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  let total = 0;

  return (
    <div className="space-y-6">
      {rooms.map((r) => {
        const s = sizeRoom({ name: r.name, surfaceM2: parseDecimal(r.surface) ?? 1, ceilingHeightM: parseDecimal(r.height) ?? 2.5, orientation: r.orientation, insulation: r.insulation, largeGlazing: r.largeGlazing, underRoof: r.underRoof }, sizing);
        const forced = parseDecimal(r.overrideW);
        const used = forced && forced > 0 ? forced : s.watts;
        total += used;
        return (
          <Card key={r.id} title={r.name}>
            <p className="text-4xl font-extrabold text-brand">
              {(used / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} kW
              {forced ? <span className="ml-2 align-middle text-base font-bold text-amber-700">valeur forcée</span> : null}
            </p>
            <details className="rounded-xl bg-slate-100 p-3 text-base" open>
              <summary className="cursor-pointer font-bold">Détail du calcul</summary>
              <p className="mt-2">{s.explanation}</p>
            </details>
            <Field
              label="Forcer une autre puissance (facultatif)"
              value={r.overrideW}
              onChange={(v) => setRooms(rooms.map((x) => (x.id === r.id ? { ...x, overrideW: v } : x)))}
              inputMode="numeric"
              suffix="W"
              placeholder={String(s.watts)}
              hint="Si vous connaissez mieux le logement (bilan thermique, exposition particulière…)"
            />
          </Card>
        );
      })}
      <Notice>
        Total : <strong>{(total / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} kW</strong> en froid. Méthode simplifiée (W/m³ × coefficients) :{" "}
        <Link href="/app/parametres/coefficients" className="underline">
          modifier les coefficients
        </Link>
        .
      </Notice>
      {msg && <Notice tone="danger">{msg}</Notice>}
      <Button
        type="button"
        full
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await saveRooms(quoteId, rooms, gainableAccess);
            setMsg(r.ok ? null : r.message ?? null);
            if (r.ok) {
              router.push(`/app/devis/${quoteId}?etape=4`);
              router.refresh();
            }
          })
        }
      >
        {pending ? "Enregistrement…" : "Suivant : les solutions"}
      </Button>
    </div>
  );
}
