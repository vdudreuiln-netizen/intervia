"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Choice, Field, Notice, Select } from "@/components/ui";
import { INSULATION_LABELS, ORIENTATION_LABELS, type Insulation, type Orientation } from "@/lib/sizing/sizing";
import { LEVEL_LABELS, newRoom, type RoomForm } from "@/lib/quote/rooms";
import type { IndoorChoice } from "@/lib/quote/types";
import { saveRooms } from "../../actions";
import { Check } from "./ClientStep";

const INDOOR_LABELS: Record<IndoorChoice, string> = { mural: "Murale", console: "Console", cassette: "Cassette" };

export function RoomsStep({ quoteId, initial, gainableAccess, nextStep, submitLabel }: { quoteId: string; initial: RoomForm[]; gainableAccess: boolean; nextStep: number; submitLabel: string }) {
  const router = useRouter();
  const [rooms, setRooms] = useState<RoomForm[]>(initial.length ? initial : [newRoom(0)]);
  const [gainable, setGainable] = useState(gainableAccess);
  const [errors, setErrors] = useState<Record<string, Record<string, string>>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const update = (id: string, patch: Partial<RoomForm>) => setRooms((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  return (
    <div className="space-y-6">
      {rooms.map((r, i) => {
        const e = errors[r.id] ?? {};
        return (
          <Card key={r.id} title={r.name.trim() || `Pièce ${i + 1}`}>
            <Field label="Nom de la pièce" value={r.name} onChange={(v) => update(r.id, { name: v })} placeholder="Salon, chambre 1…" />
            <div className="grid grid-cols-2 gap-3">
              <Field label="Surface" value={r.surface} onChange={(v) => update(r.id, { surface: v })} error={e.surface} inputMode="decimal" suffix="m²" />
              <Field label="Hauteur" value={r.height} onChange={(v) => update(r.id, { height: v })} error={e.height} inputMode="decimal" suffix="m" />
            </div>
            <Choice
              label="Orientation des fenêtres principales"
              value={r.orientation}
              onChange={(v: Orientation) => update(r.id, { orientation: v })}
              options={(Object.keys(ORIENTATION_LABELS) as Orientation[]).map((o) => ({ value: o, label: ORIENTATION_LABELS[o] }))}
            />
            <Choice
              label="Isolation"
              value={r.insulation}
              onChange={(v: Insulation) => update(r.id, { insulation: v })}
              options={(Object.keys(INSULATION_LABELS) as Insulation[]).map((o) => ({ value: o, label: INSULATION_LABELS[o] }))}
            />
            <Check label="Grandes surfaces vitrées" checked={r.largeGlazing} onChange={(v) => update(r.id, { largeGlazing: v })} />
            <Check label="Pièce sous toiture / dernier étage" checked={r.underRoof} onChange={(v) => update(r.id, { underRoof: v })} />
            <div className="grid grid-cols-2 gap-3">
              <Select label="Niveau" value={String(r.level)} onChange={(v) => update(r.id, { level: Number(v) })} options={Object.entries(LEVEL_LABELS).map(([value, label]) => ({ value, label }))} placeholder="Niveau…" />
              <Select label="Unité souhaitée" value={r.indoorType} onChange={(v) => update(r.id, { indoorType: (v || "mural") as IndoorChoice })} options={Object.entries(INDOOR_LABELS).map(([value, label]) => ({ value, label }))} placeholder="Murale" />
            </div>
            {rooms.length > 1 && (
              <button type="button" className="min-h-12 w-full rounded-xl border-2 border-slate-400 text-base font-bold text-slate-700" onClick={() => setRooms(rooms.filter((x) => x.id !== r.id))}>
                Supprimer cette pièce
              </button>
            )}
          </Card>
        );
      })}
      <Button type="button" variant="secondary" full onClick={() => setRooms([...rooms, newRoom(rooms.length)])}>
        + Ajouter une pièce
      </Button>
      <Card title="Logement">
        <Check label="Combles ou faux plafond accessibles" hint="Permet de proposer une solution gainable" checked={gainable} onChange={setGainable} />
      </Card>
      {msg && <Notice tone="danger">{msg}</Notice>}
      <Button
        type="button"
        full
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await saveRooms(quoteId, rooms, gainable);
            setErrors(r.errors ?? {});
            setMsg(r.ok ? null : r.message ?? null);
            if (r.ok) {
              router.push(`/app/devis/${quoteId}?etape=${nextStep}`);
              router.refresh();
            }
          })
        }
      >
        {pending ? "Enregistrement…" : submitLabel}
      </Button>
    </div>
  );
}
