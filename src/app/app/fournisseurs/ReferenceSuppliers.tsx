"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Notice, Select } from "@/components/ui";
import { setReferenceSupplier } from "./actions";

const NONE = "__aucun__";

export function ReferenceSuppliers({ brands, suppliers }: { brands: { id: string; name: string; referenceSupplierId: string | null }[]; suppliers: { id: string; name: string }[] }) {
  const router = useRouter();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-3">
      {brands.map((b) => (
        <Select
          key={b.id}
          label={b.name}
          value={b.referenceSupplierId ?? NONE}
          onChange={(v) =>
            !pending &&
            start(async () => {
              const r = await setReferenceSupplier(b.id, v === NONE ? null : v);
              setMsg({ ok: r.ok, text: r.message ?? "" });
              if (r.ok) router.refresh();
            })
          }
          options={[{ value: NONE, label: "Prix public le plus élevé" }, ...suppliers.map((s) => ({ value: s.id, label: s.name }))]}
        />
      ))}
      {msg && <Notice tone={msg.ok ? "ok" : "danger"}>{msg.text}</Notice>}
    </div>
  );
}
