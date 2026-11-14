"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Button, Field, Notice } from "@/components/ui";
import { joinCompany } from "./actions";

export function JoinForm({ token, askPassword }: { token: string; askPassword: boolean }) {
  const [password, setPassword] = useState("");
  const [terms, setTerms] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-4">
      {askPassword && <Field label="Choisissez votre mot de passe" value={password} onChange={setPassword} type="password" autoComplete="new-password" hint="8 caractères minimum, pour vos prochaines connexions" />}
      <label className="flex items-start gap-3 text-base">
        <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} className="mt-1 h-6 w-6 shrink-0 accent-brand" />
        <span>
          J&apos;accepte les <Link href="/cgv" target="_blank" className="font-bold text-brand underline">conditions générales</Link> et la{" "}
          <Link href="/confidentialite" target="_blank" className="font-bold text-brand underline">politique de confidentialité</Link>.
        </span>
      </label>
      {msg && <Notice tone="danger">{msg}</Notice>}
      <Button
        type="button"
        full
        disabled={pending || !terms || (askPassword && password.length < 8)}
        onClick={() =>
          start(async () => {
            const r = await joinCompany(token, askPassword ? password : "", terms);
            if (r) setMsg(r.message);
          })
        }
      >
        {pending ? "Un instant…" : "Rejoindre l'équipe"}
      </Button>
    </div>
  );
}
