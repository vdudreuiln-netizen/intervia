"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AddressInput } from "@/components/AddressInput";
import { ImageUpload } from "@/components/ImageUpload";
import { Button, Card, Choice, Field, MoneyField, Notice, PercentField, TextArea } from "@/components/ui";
import { parseCompanyForm, STEPS, vatNumberFromSiren, type CompanyField, type CompanyForm as Form, type FieldErrors, type StepId } from "@/lib/company/settings";
import { saveCompany } from "./actions";

interface Props {
  mode: "onboarding" | "settings";
  companyId: string;
  initial: Form;
  logoUrl: string | null;
  stampUrl: string | null;
}

export function CompanyForm({ mode, companyId, initial, logoUrl, stampUrl }: Props) {
  const router = useRouter();
  const [form, setForm] = useState<Form>(initial);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [stepIndex, setStepIndex] = useState(0);
  const [status, setStatus] = useState<{ step: StepId; tone: "ok" | "danger"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const set = (k: CompanyField) => (v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => ({ ...e, [k]: undefined }));
  };
  const setMany = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));

  function save(step: StepId, fields: CompanyField[], finish: boolean, after?: () => void) {
    const local = parseCompanyForm(form, fields);
    if (!local.ok) {
      setErrors(local.errors);
      setStatus({ step, tone: "danger", text: "Certains champs sont à corriger." });
      return;
    }
    startTransition(async () => {
      const res = await saveCompany(fields, form, finish);
      setErrors(res.errors ?? {});
      setStatus({ step, tone: res.ok ? "ok" : "danger", text: res.message ?? "" });
      if (res.ok) after?.();
    });
  }

  const e = errors;
  const assujetti = form.vat_regime === "assujetti";

  const sections: Record<StepId, React.ReactNode> = {
    entreprise: (
      <>
        <Field label="Raison sociale" value={form.legal_name} onChange={set("legal_name")} error={e.legal_name} autoComplete="organization" />
        <Field label="SIRET" value={form.siret} onChange={set("siret")} error={e.siret} inputMode="numeric" hint="14 chiffres, sur votre avis de situation INSEE ou votre Kbis" />
        <AddressInput
          label="Adresse"
          value={form.address_line}
          onChange={set("address_line")}
          error={e.address_line}
          onSelect={(s) => setMany({ address_line: s.street || s.label, postal_code: s.postcode, city: s.city })}
        />
        <div className="grid grid-cols-[8rem_1fr] gap-3">
          <Field label="Code postal" value={form.postal_code} onChange={set("postal_code")} error={e.postal_code} inputMode="numeric" autoComplete="postal-code" />
          <Field label="Ville" value={form.city} onChange={set("city")} error={e.city} autoComplete="address-level2" />
        </div>
        <Field label="Téléphone" value={form.phone} onChange={set("phone")} error={e.phone} inputMode="tel" type="tel" autoComplete="tel" />
        <Field label="E-mail" value={form.email} onChange={set("email")} error={e.email} inputMode="email" type="email" autoComplete="email" />
      </>
    ),
    visuels: (
      <>
        <ImageUpload label="Logo" hint="Il apparaîtra en haut de vos devis." companyId={companyId} kind="logo" path={form.logo_path} initialPreview={logoUrl} onChange={set("logo_path")} />
        <ImageUpload
          label="Tampon / signature"
          hint="Photo de votre tampon signé, idéalement sur fond blanc. Il apparaîtra en bas du devis."
          companyId={companyId}
          kind="tampon"
          path={form.stamp_path}
          initialPreview={stampUrl}
          onChange={set("stamp_path")}
        />
        {mode === "onboarding" && <p className="text-base text-slate-600">Facultatif : vous pourrez les ajouter plus tard dans les paramètres.</p>}
      </>
    ),
    assurance: (
      <>
        <h3 className="text-lg font-bold">Assurance décennale</h3>
        <Field label="Assureur" value={form.insurer_name} onChange={set("insurer_name")} error={e.insurer_name} />
        <Field label="N° de contrat" value={form.insurance_policy} onChange={set("insurance_policy")} error={e.insurance_policy} />
        <Field
          label="Zone géographique couverte"
          value={form.insurance_coverage}
          onChange={set("insurance_coverage")}
          error={e.insurance_coverage}
          hint="Mention obligatoire sur le devis. Ex. : France métropolitaine"
        />
        <h3 className="pt-2 text-lg font-bold">Coordonnées bancaires (bas du devis)</h3>
        <Field label="Titulaire du compte" value={form.bank_holder} onChange={set("bank_holder")} error={e.bank_holder} />
        <Field label="IBAN" value={form.iban} onChange={set("iban")} error={e.iban} autoCapitalize="characters" hint="27 caractères, commence par FR76" />
        <Field label="BIC" value={form.bic} onChange={set("bic")} error={e.bic} autoCapitalize="characters" />
      </>
    ),
    tva: (
      <>
        <Choice
          label="Régime de TVA"
          value={form.vat_regime as "franchise" | "assujetti"}
          onChange={set("vat_regime")}
          error={e.vat_regime}
          options={[
            { value: "franchise", label: "Franchise en base (pas de TVA)", hint: "Mention « TVA non applicable, art. 293 B du CGI », devis en HT" },
            { value: "assujetti", label: "Je facture la TVA", hint: "10 % par défaut (rénovation), modifiable ligne par ligne" },
          ]}
        />
        {assujetti && (
          <>
            <Field label="N° de TVA intracommunautaire" value={form.vat_number} onChange={set("vat_number")} error={e.vat_number} autoCapitalize="characters" />
            {!form.vat_number && vatNumberFromSiren(form.siret) && (
              <Button type="button" variant="secondary" onClick={() => set("vat_number")(vatNumberFromSiren(form.siret)!)}>
                Calculer depuis mon SIRET
              </Button>
            )}
            <Choice
              label="Taux de TVA proposé par défaut"
              value={form.default_vat_rate as "5,5" | "10" | "20"}
              onChange={set("default_vat_rate")}
              error={e.default_vat_rate}
              options={[
                { value: "10", label: "10 %", hint: "Travaux dans un logement de plus de 2 ans" },
                { value: "5,5", label: "5,5 %", hint: "Travaux de rénovation énergétique éligibles" },
                { value: "20", label: "20 %", hint: "Neuf, local professionnel" },
              ]}
            />
          </>
        )}
        <h3 className="pt-2 text-lg font-bold">Charges sociales</h3>
        <p className="text-base text-slate-600">En % du chiffre d&apos;affaires HT. Micro-entrepreneur 2026 : 21,2 % sur les prestations, 12,3 % sur la vente de matériel. Vous pouvez y ajouter vos frais fixes pour une marge vraiment nette.</p>
        <PercentField label="Sur la main d'œuvre" value={form.labor_charges_rate} onChange={set("labor_charges_rate")} error={e.labor_charges_rate} />
        <PercentField label="Sur le matériel" value={form.material_charges_rate} onChange={set("material_charges_rate")} error={e.material_charges_rate} />
      </>
    ),
    main_oeuvre: (
      <>
        <MoneyField label="Prix d'une journée de main d'œuvre (HT)" value={form.daily_labor_rate_cents} onChange={set("daily_labor_rate_cents")} error={e.daily_labor_rate_cents} hint="Ce que vous facturez au client pour une journée de pose" />
        <MoneyField label="Objectif de marge nette par jour de chantier" value={form.target_margin_per_day_cents} onChange={set("target_margin_per_day_cents")} error={e.target_margin_per_day_cents} hint="Une alerte rouge s'affiche si un devis passe en dessous" />
        <Field label="Validité des devis" value={form.quote_validity_days} onChange={set("quote_validity_days")} error={e.quote_validity_days} inputMode="numeric" suffix="jours" />
        <TextArea label="Conditions de paiement" value={form.payment_terms} onChange={set("payment_terms")} error={e.payment_terms} hint="Imprimées sur chaque devis" />
      </>
    ),
    deplacement: (
      <>
        <Button
          type="button"
          variant="secondary"
          full
          onClick={() =>
            setMany({ base_address: form.address_line, base_postal_code: form.postal_code, base_city: form.city, base_citycode: "", base_lat: "", base_lng: "" })
          }
        >
          Partir de l&apos;adresse de l&apos;entreprise
        </Button>
        <AddressInput
          label="Adresse de départ (dépôt, domicile)"
          value={form.base_address}
          onChange={(v) => setMany({ base_address: v, base_citycode: "", base_lat: "", base_lng: "" })}
          error={e.base_address}
          hint="Choisissez dans la liste pour que les distances soient calculées automatiquement"
          onSelect={(s) =>
            setMany({ base_address: s.street || s.label, base_postal_code: s.postcode, base_city: s.city, base_citycode: s.citycode, base_lat: String(s.lat), base_lng: String(s.lng) })
          }
        />
        <div className="grid grid-cols-[8rem_1fr] gap-3">
          <Field label="Code postal" value={form.base_postal_code} onChange={set("base_postal_code")} error={e.base_postal_code} inputMode="numeric" />
          <Field label="Ville" value={form.base_city} onChange={set("base_city")} error={e.base_city} />
        </div>
        {form.base_address && !form.base_lat && <Notice>Adresse non localisée : choisissez une suggestion pour activer le calcul automatique des distances.</Notice>}
        <MoneyField label="Prix au km" value={form.travel_price_per_km_cents} onChange={set("travel_price_per_km_cents")} error={e.travel_price_per_km_cents} hint="Appliqué aux km aller + retour, un aller-retour par jour de chantier" />
        <MoneyField label="Minimum par aller-retour" value={form.travel_minimum_fee_cents} onChange={set("travel_minimum_fee_cents")} error={e.travel_minimum_fee_cents} />
        <h3 className="pt-2 text-lg font-bold">Stationnement (activable par chantier)</h3>
        <MoneyField label="Stationnement par jour proposé" value={form.parking_per_day_cents} onChange={set("parking_per_day_cents")} error={e.parking_per_day_cents} hint="Ex. centre de Bordeaux : 40 €. Modifiable sur chaque chantier." />
        <MoneyField
          label="Minimum par jour déplacement + stationnement"
          value={form.travel_min_daily_with_parking_cents}
          onChange={set("travel_min_daily_with_parking_cents")}
          error={e.travel_min_daily_with_parking_cents}
          hint="Ex. 60 € : s'applique seulement quand le stationnement est activé"
        />
        <p className="text-base text-slate-600">Aucun frais de déplacement n&apos;est facturé quand le chantier est dans votre commune.</p>
      </>
    ),
  };

  if (mode === "onboarding") {
    const step = STEPS[stepIndex]!;
    const last = stepIndex === STEPS.length - 1;
    return (
      <div className="space-y-4">
        <div>
          <p className="text-base font-bold text-brand">
            Étape {stepIndex + 1} sur {STEPS.length}
          </p>
          <div className="mt-2 h-3 w-full overflow-hidden rounded-full bg-slate-300" aria-hidden>
            <div className="h-full bg-brand transition-all" style={{ width: `${((stepIndex + 1) / STEPS.length) * 100}%` }} />
          </div>
        </div>
        <Card title={step.title}>{sections[step.id]}</Card>
        {status?.step === step.id && status.tone === "danger" && <Notice tone="danger">{status.text}</Notice>}
        <div className="flex flex-col-reverse gap-3 sm:flex-row">
          {stepIndex > 0 && (
            <Button type="button" variant="secondary" onClick={() => setStepIndex(stepIndex - 1)} disabled={pending}>
              Précédent
            </Button>
          )}
          <Button
            type="button"
            full
            disabled={pending}
            onClick={() =>
              save(step.id, step.fields, last, () => {
                setStatus(null);
                if (last) router.push("/app");
                else {
                  setStepIndex(stepIndex + 1);
                  window.scrollTo({ top: 0 });
                }
              })
            }
          >
            {pending ? "Enregistrement…" : last ? "Terminer" : "Suivant"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {STEPS.map((step) => (
        <Card
          key={step.id}
          title={step.title}
          actions={
            <Button type="button" onClick={() => save(step.id, step.fields, false)} disabled={pending} full>
              Enregistrer
            </Button>
          }
        >
          {sections[step.id]}
          {status?.step === step.id && <Notice tone={status.tone}>{status.text}</Notice>}
        </Card>
      ))}
    </div>
  );
}
