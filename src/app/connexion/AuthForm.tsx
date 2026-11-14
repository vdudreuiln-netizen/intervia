"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { signIn, signUp, type AuthState } from "./actions";
import { Button, Notice } from "@/components/ui";

const input = "block w-full min-h-14 rounded-xl border-2 border-slate-400 bg-white px-4 text-lg focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/20";

export function AuthForm({ initialMode }: { initialMode: "connexion" | "inscription" }) {
  const [mode, setMode] = useState(initialMode);
  const [state, action, pending] = useActionState<AuthState, FormData>(mode === "connexion" ? signIn : signUp, {});
  const signup = mode === "inscription";

  return (
    <form action={action} className="space-y-5">
      <h1 className="text-3xl font-extrabold">{signup ? "Créer mon compte" : "Connexion"}</h1>
      {signup && (
        <label className="block text-base font-bold">
          Nom de votre entreprise
          <input name="legal_name" autoComplete="organization" required className={`${input} mt-1`} />
        </label>
      )}
      <label className="block text-base font-bold">
        E-mail
        <input name="email" type="email" autoComplete="email" inputMode="email" required className={`${input} mt-1`} />
      </label>
      <label className="block text-base font-bold">
        Mot de passe
        <input name="password" type="password" autoComplete={signup ? "new-password" : "current-password"} minLength={signup ? 8 : undefined} required className={`${input} mt-1`} />
        {signup && <span className="mt-1 block text-sm font-normal text-slate-600">8 caractères minimum</span>}
      </label>
      {state.error && <Notice tone="danger">{state.error}</Notice>}
      {state.info && <Notice tone="ok">{state.info}</Notice>}
      <Button type="submit" full disabled={pending}>
        {pending ? "Un instant…" : signup ? "Démarrer mon essai gratuit" : "Me connecter"}
      </Button>
      {signup && <p className="text-center text-sm text-slate-600">14 jours gratuits, sans carte bancaire.</p>}
      <button type="button" onClick={() => setMode(signup ? "connexion" : "inscription")} className="block w-full py-3 text-center text-lg font-bold text-brand underline underline-offset-4">
        {signup ? "J'ai déjà un compte" : "Créer un compte"}
      </button>
      <Link href="/" className="block text-center text-base text-slate-600 underline">
        Retour
      </Link>
    </form>
  );
}
