/**
 * Composants d'interface : gros boutons, gros champs, fort contraste.
 * Pensés pour un usage au doigt, sur téléphone, en plein soleil.
 */
import Link from "next/link";
import { useId, type ComponentProps, type ReactNode } from "react";

type Variant = "primary" | "secondary" | "danger" | "ghost";

const variants: Record<Variant, string> = {
  primary: "bg-brand text-white hover:bg-brand-dark active:bg-brand-dark",
  secondary: "bg-white text-brand border-2 border-brand hover:bg-brand-light",
  danger: "bg-danger text-white hover:opacity-90",
  ghost: "bg-transparent text-brand underline underline-offset-4",
};

export function buttonClass(variant: Variant = "primary", full = false) {
  return [
    "inline-flex min-h-14 items-center justify-center gap-2 rounded-xl px-6 text-lg font-bold",
    "focus:outline-none focus-visible:ring-4 focus-visible:ring-brand/40 disabled:opacity-50",
    variants[variant],
    full ? "w-full" : "",
  ].join(" ");
}

export function Button({ variant = "primary", full, className = "", ...props }: ComponentProps<"button"> & { variant?: Variant; full?: boolean }) {
  return <button className={`${buttonClass(variant, full)} ${className}`} {...props} />;
}

export function LinkButton({ variant = "primary", full, className = "", ...props }: ComponentProps<typeof Link> & { variant?: Variant; full?: boolean }) {
  return <Link className={`${buttonClass(variant, full)} ${className}`} {...props} />;
}

export function Card({ title, children, actions }: { title?: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="rounded-2xl border-2 border-slate-300 bg-white p-4 sm:p-6">
      {title && <h2 className="mb-4 text-xl font-bold text-slate-900">{title}</h2>}
      <div className="space-y-5">{children}</div>
      {actions && <div className="mt-6 flex flex-col gap-3 sm:flex-row">{actions}</div>}
    </section>
  );
}

const inputBase =
  "block w-full min-h-14 rounded-xl border-2 bg-white px-4 text-lg text-slate-900 placeholder:text-slate-400 " +
  "focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/20";

interface FieldProps extends Omit<ComponentProps<"input">, "onChange" | "value"> {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  error?: string;
  suffix?: string;
}

export function Field({ label, hint, error, suffix, value, onChange, id, ...props }: FieldProps) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  return (
    <div>
      <label htmlFor={fieldId} className="mb-1 block text-base font-bold text-slate-900">
        {label}
      </label>
      <div className="relative">
        <input
          id={fieldId}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={!!error}
          aria-describedby={error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined}
          className={`${inputBase} ${error ? "border-danger" : "border-slate-400"} ${suffix ? "pr-14" : ""}`}
          {...props}
        />
        {suffix && <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-lg font-bold text-slate-600">{suffix}</span>}
      </div>
      {hint && !error && (
        <p id={`${fieldId}-hint`} className="mt-1 text-sm text-slate-600">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${fieldId}-error`} role="alert" className="mt-1 text-base font-bold text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

export function MoneyField(props: Omit<FieldProps, "suffix" | "inputMode">) {
  return <Field inputMode="decimal" autoComplete="off" suffix="€" {...props} />;
}

export function PercentField(props: Omit<FieldProps, "suffix" | "inputMode">) {
  return <Field inputMode="decimal" autoComplete="off" suffix="%" {...props} />;
}

export function TextArea({ label, value, onChange, hint, error, rows = 3 }: { label: string; value: string; onChange: (v: string) => void; hint?: string; error?: string; rows?: number }) {
  return (
    <div>
      <label className="mb-1 block text-base font-bold text-slate-900">
        {label}
        <textarea
          value={value}
          rows={rows}
          onChange={(e) => onChange(e.target.value)}
          className={`${inputBase} mt-1 py-3 font-normal ${error ? "border-danger" : "border-slate-400"}`}
        />
      </label>
      {hint && !error && <p className="mt-1 text-sm text-slate-600">{hint}</p>}
      {error && <p role="alert" className="mt-1 text-base font-bold text-danger">{error}</p>}
    </div>
  );
}

/** Choix exclusif en gros boutons (plus simple qu'une liste déroulante au doigt). */
export function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
  error,
}: {
  label: string;
  value: T | "";
  options: { value: T; label: string; hint?: string }[];
  onChange: (v: T) => void;
  error?: string;
}) {
  return (
    <fieldset>
      <legend className="mb-2 text-base font-bold text-slate-900">{label}</legend>
      <div className="grid gap-3">
        {options.map((o) => {
          const selected = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(o.value)}
              className={`min-h-14 rounded-xl border-2 px-4 py-3 text-left text-lg ${selected ? "border-brand bg-brand-light font-bold text-brand-dark" : "border-slate-400 bg-white text-slate-900"}`}
            >
              <span className="flex items-center gap-3">
                <span aria-hidden className={`inline-block h-6 w-6 shrink-0 rounded-full border-2 ${selected ? "border-brand bg-brand ring-4 ring-inset ring-white" : "border-slate-400"}`} />
                <span>
                  {o.label}
                  {o.hint && <span className="block text-sm font-normal text-slate-600">{o.hint}</span>}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      {error && <p role="alert" className="mt-1 text-base font-bold text-danger">{error}</p>}
    </fieldset>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "danger" | "ok"; children: ReactNode }) {
  const cls = {
    info: "border-brand bg-brand-light text-brand-dark",
    danger: "border-danger bg-danger-light text-danger",
    ok: "border-ok bg-ok-light text-ok",
  }[tone];
  return <div role={tone === "danger" ? "alert" : "status"} className={`rounded-xl border-2 p-4 text-base font-semibold ${cls}`}>{children}</div>;
}

export function Select({
  label,
  value,
  onChange,
  options,
  error,
  hint,
  placeholder = "Choisir…",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  error?: string;
  hint?: string;
  placeholder?: string;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-base font-bold text-slate-900">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={!!error}
        className={`${inputBase} appearance-none bg-[length:1.5rem] bg-[right_0.75rem_center] bg-no-repeat pr-12 ${error ? "border-danger" : "border-slate-400"}`}
        style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%230B4F8A' stroke-width='3'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E\")" }}
      >
        <option value="">{placeholder}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {hint && !error && <p className="mt-1 text-sm text-slate-600">{hint}</p>}
      {error && <p role="alert" className="mt-1 text-base font-bold text-danger">{error}</p>}
    </div>
  );
}
