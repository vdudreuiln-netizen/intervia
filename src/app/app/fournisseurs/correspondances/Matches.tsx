"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Notice } from "@/components/ui";
import { formatEuros } from "@/lib/format";
import { confirmMatch, rejectMatch } from "../actions";

export interface MatchItem {
  id: string;
  supplier: string;
  tariffRef: string;
  tariffLabel: string | null;
  priceCents: number | null;
  catalogLabel: string;
  reason: string | null;
}

export function Matches({ items }: { items: MatchItem[] }) {
  const router = useRouter();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const act = (fn: () => Promise<{ ok: boolean; message?: string }>) =>
    start(async () => {
      const r = await fn();
      setMsg({ ok: r.ok, text: r.message ?? "" });
      if (r.ok) router.refresh();
    });
  return (
    <div className="space-y-3">
      {msg && <Notice tone={msg.ok ? "ok" : "danger"}>{msg.text}</Notice>}
      <ul className="space-y-3">
        {items.map((m) => (
          <li key={m.id} className="rounded-2xl border-2 border-slate-300 p-4">
            <p className="text-sm font-bold uppercase text-slate-600">{m.supplier}</p>
            <p className="text-lg">
              Tarif : <strong>{m.tariffRef}</strong> {m.tariffLabel && <span className="text-slate-700">· {m.tariffLabel}</span>} {m.priceCents !== null && <span>· {formatEuros(m.priceCents)}</span>}
            </p>
            <p className="text-lg">
              Votre catalogue : <strong>{m.catalogLabel}</strong>
            </p>
            {m.reason && <p className="text-sm text-slate-600">{m.reason}</p>}
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button type="button" disabled={pending} onClick={() => act(() => confirmMatch(m.id))}>
                Même article
              </Button>
              <Button type="button" variant="secondary" disabled={pending} onClick={() => act(() => rejectMatch(m.id))}>
                Article différent
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
