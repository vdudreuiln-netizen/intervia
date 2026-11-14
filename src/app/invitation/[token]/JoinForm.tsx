"use client";

import { useState, useTransition } from "react";
import { Button, Field, Notice } from "@/components/ui";
import { joinCompany } from "./actions";

export function JoinForm({ token, askPassword }: { token: string; askPassword: boolean }) {
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-4">
      {askPassword && <Field label="Choisissez votre mot de passe" value={password} onChange={setPassword} type="password" autoComplete="new-password" hint="8 caractères minimum, pour vos prochaines connexions" />}
      {msg && <Notice tone="danger">{msg}</Notice>}
      <Button
        type="button"
        full
        disabled={pending || (askPassword && password.length < 8)}
        onClick={() =>
          start(async () => {
            const r = await joinCompany(token, askPassword ? password : "");
            if (r) setMsg(r.message);
          })
        }
      >
        {pending ? "Un instant…" : "Rejoindre l'équipe"}
      </Button>
    </div>
  );
}
