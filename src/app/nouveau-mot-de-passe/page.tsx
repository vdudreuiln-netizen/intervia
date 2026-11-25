"use client";

import { useActionState } from "react";
import { Button, LinkButton, Notice } from "@/components/ui";
import { setNewPassword } from "../mot-de-passe-oublie/actions";

export default function NewPasswordPage() {
  const [state, action, pending] = useActionState(setNewPassword, {});
  return (
    <main className="mx-auto max-w-md space-y-5 px-4 py-10">
      <h1 className="text-3xl font-extrabold">Nouveau mot de passe</h1>
      {state.done ? (
        <>
          <Notice tone="ok">Mot de passe enregistré.</Notice>
          <LinkButton href="/app" full>
            Ouvrir ClimDevis
          </LinkButton>
        </>
      ) : (
        <form action={action} className="space-y-5">
          <label className="block text-base font-bold">
            Nouveau mot de passe
            <input name="password" type="password" required minLength={8} autoComplete="new-password" className="mt-1 block min-h-14 w-full rounded-xl border-2 border-slate-400 px-4 text-lg" />
            <span className="mt-1 block text-sm font-normal text-slate-600">8 caractères minimum</span>
          </label>
          {state.error && <Notice tone="danger">{state.error}</Notice>}
          <Button type="submit" full disabled={pending}>
            Enregistrer
          </Button>
        </form>
      )}
    </main>
  );
}
