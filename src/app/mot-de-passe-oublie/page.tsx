"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button, Notice } from "@/components/ui";
import { requestReset } from "./actions";

export default function ForgotPasswordPage() {
  const [state, action, pending] = useActionState(requestReset, {});
  return (
    <main className="mx-auto max-w-md space-y-5 px-4 py-10">
      <h1 className="text-3xl font-extrabold">Mot de passe oublié</h1>
      {state.done ? (
        <Notice tone="ok">Si un compte existe avec cette adresse, vous allez recevoir un e-mail pour choisir un nouveau mot de passe.</Notice>
      ) : (
        <form action={action} className="space-y-5">
          <label className="block text-base font-bold">
            E-mail
            <input name="email" type="email" required autoComplete="email" className="mt-1 block min-h-14 w-full rounded-xl border-2 border-slate-400 px-4 text-lg" />
          </label>
          {state.error && <Notice tone="danger">{state.error}</Notice>}
          <Button type="submit" full disabled={pending}>
            Recevoir le lien
          </Button>
        </form>
      )}
      <Link href="/connexion" className="block text-center text-lg font-bold text-brand underline">
        Retour à la connexion
      </Link>
    </main>
  );
}
