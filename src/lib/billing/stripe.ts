import "server-only";
import Stripe from "stripe";

export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY manquante (voir .env.example)");
  return new Stripe(key, { appInfo: { name: "ClimDevis" } });
}

export const appUrl = () => process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

/** Mention imprimée sur les factures Stripe tant que l'éditeur est en franchise de TVA. */
export const INVOICE_FOOTER = "TVA non applicable, art. 293 B du CGI";
