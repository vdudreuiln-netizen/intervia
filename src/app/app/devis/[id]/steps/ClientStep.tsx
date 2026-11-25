"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AddressInput } from "@/components/AddressInput";
import { Button, Card, Field, MoneyField, Notice } from "@/components/ui";
import type { AddressSuggestion } from "@/lib/geo/adresse";
import type { ClientSiteErrors, ClientSiteForm } from "@/lib/quote/client";
import { computeDistance, saveClientSite } from "../../actions";

export function Check({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label className={`flex min-h-14 cursor-pointer items-start gap-3 rounded-xl border-2 px-4 py-3 text-lg ${checked ? "border-brand bg-brand-light" : "border-slate-400 bg-white"}`}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-1 h-6 w-6 shrink-0 accent-brand" />
      <span className="font-semibold">
        {label}
        {hint && <span className="block text-sm font-normal text-slate-600">{hint}</span>}
      </span>
    </label>
  );
}

export function ClientStep({ quoteId, initial }: { quoteId: string | null; initial: ClientSiteForm }) {
  const router = useRouter();
  const [f, setF] = useState(initial);
  const [errors, setErrors] = useState<ClientSiteErrors>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [distanceInfo, setDistanceInfo] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = <K extends keyof ClientSiteForm>(k: K) => (v: ClientSiteForm[K]) => {
    setF((x) => ({ ...x, [k]: v }));
    setErrors((e) => ({ ...e, [k]: undefined }));
  };

  async function locate(s: AddressSuggestion) {
    setDistanceInfo("Calcul de la distance…");
    const r = await computeDistance({ lat: s.lat, lng: s.lng, citycode: s.citycode, postcode: s.postcode, city: s.city });
    setF((x) => ({
      ...x,
      site_citycode: s.citycode,
      site_lat: String(s.lat),
      site_lng: String(s.lng),
      same_commune: r.sameCommune ?? x.same_commune,
      one_way_km: r.oneWayKm !== undefined ? String(r.oneWayKm).replace(".", ",") : x.one_way_km,
    }));
    if (!r.ok) setDistanceInfo(r.message ?? null);
    else if (r.sameCommune) setDistanceInfo("Chantier dans votre commune : pas de frais de déplacement.");
    else setDistanceInfo(r.source === "route" ? `Distance par la route : ${r.oneWayKm?.toLocaleString("fr-FR")} km (aller).` : `Estimation : ${r.oneWayKm?.toLocaleString("fr-FR")} km (service d'itinéraire indisponible), vérifiez.`);
  }

  return (
    <div className="space-y-6">
      <Card title="Client">
        <Field label="Nom du client" value={f.client_name} onChange={set("client_name")} error={errors.client_name} autoComplete="off" />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Téléphone" value={f.client_phone} onChange={set("client_phone")} error={errors.client_phone} inputMode="tel" type="tel" />
          <Field label="E-mail" value={f.client_email} onChange={set("client_email")} error={errors.client_email} inputMode="email" type="email" />
        </div>
        <AddressInput
          label="Adresse du client"
          value={f.client_address}
          onChange={set("client_address")}
          onSelect={(s) => {
            setF((x) => ({ ...x, client_address: s.street || s.label, client_postal_code: s.postcode, client_city: s.city }));
            if (f.site_same) void locate(s);
          }}
        />
        <div className="grid grid-cols-[8rem_1fr] gap-3">
          <Field label="Code postal" value={f.client_postal_code} onChange={set("client_postal_code")} inputMode="numeric" />
          <Field label="Ville" value={f.client_city} onChange={set("client_city")} error={errors.client_city} />
        </div>
      </Card>
      <Card title="Chantier">
        <Check label="Le chantier est à l'adresse du client" checked={f.site_same} onChange={set("site_same")} />
        {!f.site_same && (
          <>
            <AddressInput
              label="Adresse du chantier"
              value={f.site_address}
              onChange={set("site_address")}
              onSelect={(s) => {
                setF((x) => ({ ...x, site_address: s.street || s.label, site_postal_code: s.postcode, site_city: s.city }));
                void locate(s);
              }}
            />
            <div className="grid grid-cols-[8rem_1fr] gap-3">
              <Field label="Code postal" value={f.site_postal_code} onChange={set("site_postal_code")} inputMode="numeric" />
              <Field label="Ville" value={f.site_city} onChange={set("site_city")} error={errors.site_city} />
            </div>
          </>
        )}
        {distanceInfo && <Notice>{distanceInfo}</Notice>}
        <Check label="Chantier dans ma commune" checked={f.same_commune} onChange={set("same_commune")} hint="Pas de frais de déplacement" />
        {!f.same_commune && (
          <Field label="Distance depuis votre entreprise (aller)" value={f.one_way_km} onChange={set("one_way_km")} error={errors.one_way_km} inputMode="decimal" suffix="km" hint="Calculée par la route quand vous choisissez l'adresse ; modifiable" />
        )}
        <Check label="Stationnement payant sur ce chantier" checked={f.parking_enabled} onChange={set("parking_enabled")} />
        {f.parking_enabled && <MoneyField label="Stationnement par jour" value={f.parking_per_day} onChange={set("parking_per_day")} error={errors.parking_per_day} />}
      </Card>
      {msg && <Notice tone="danger">{msg}</Notice>}
      <Button
        type="button"
        full
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await saveClientSite(quoteId, f);
            setErrors(r.errors ?? {});
            setMsg(r.ok ? null : r.message ?? null);
            if (r.ok && r.id) router.push(`/app/devis/${r.id}?etape=2`);
          })
        }
      >
        {pending ? "Enregistrement…" : "Suivant : les pièces"}
      </Button>
    </div>
  );
}
