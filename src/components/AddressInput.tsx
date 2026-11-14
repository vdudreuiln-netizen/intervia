"use client";

import { useEffect, useRef, useState } from "react";
import type { AddressSuggestion } from "@/lib/geo/adresse";
import { Field } from "./ui";

/**
 * Champ adresse avec suggestions (Géoplateforme IGN). Si le service ne répond
 * pas, l'artisan peut toujours saisir l'adresse à la main.
 */
export function AddressInput({
  label,
  value,
  onChange,
  onSelect,
  error,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onSelect: (s: AddressSuggestion) => void;
  error?: string;
  hint?: string;
}) {
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [serviceError, setServiceError] = useState<string | null>(null);
  const skipNext = useRef(false);

  useEffect(() => {
    if (skipNext.current) {
      skipNext.current = false;
      return;
    }
    const q = value.trim();
    if (q.length < 5) {
      setSuggestions([]);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/adresse?q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
        const json = (await res.json()) as { suggestions: AddressSuggestion[]; error?: string };
        setSuggestions(json.suggestions);
        setServiceError(json.error ?? null);
      } catch {
        /* requête annulée ou hors ligne : saisie manuelle */
      }
    }, 300);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [value]);

  return (
    <div>
      <Field label={label} value={value} onChange={onChange} error={error} hint={hint ?? "Tapez le début de l'adresse puis choisissez dans la liste"} autoComplete="street-address" />
      {suggestions.length > 0 && (
        <ul className="mt-2 overflow-hidden rounded-xl border-2 border-brand bg-white" role="listbox">
          {suggestions.map((s) => (
            <li key={`${s.label}-${s.lat}`}>
              <button
                type="button"
                className="block min-h-14 w-full border-b border-slate-200 px-4 py-3 text-left text-lg last:border-0 hover:bg-brand-light"
                onClick={() => {
                  skipNext.current = true;
                  setSuggestions([]);
                  onSelect(s);
                }}
              >
                {s.label}
              </button>
            </li>
          ))}
        </ul>
      )}
      {serviceError && <p className="mt-1 text-sm text-slate-600">{serviceError}</p>}
    </div>
  );
}
