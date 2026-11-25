/**
 * Contexte de calcul d'un devis (partagé client / serveur) : à partir de
 * l'entreprise, du chantier et du devis, fabrique les réglages des modules
 * de calcul. Le serveur refait exactement le même calcul à la finalisation.
 */
import { computeTravelFee, DEFAULT_VAT_RATE, type PricingSettings, type TravelFee } from "@/lib/pricing/engine";
import type { Coefficients } from "@/lib/sizing/coefficients";
import type { EquipmentOptions } from "./equipment";
import type { LineSettings } from "./lines";
import type { ProposalInput } from "./options";
import type { CatAccessory, CatProduct, RoomNeed, WizardState } from "./types";

/** Sous-ensemble des paramètres entreprise utile au calcul (envoyable au navigateur). */
export interface CompanyPricing {
  vat_regime: "franchise" | "assujetti";
  default_vat_rate: number;
  labor_charges_rate: number;
  material_charges_rate: number;
  daily_labor_rate_cents: number;
  target_margin_per_day_cents: number;
  accessory_sale_coefficient: number;
  accessory_purchase_coefficient: number;
  travel_price_per_km_cents: number;
  travel_minimum_fee_cents: number;
  travel_min_daily_with_parking_cents: number;
  parking_per_day_cents: number;
  preferred_brand_id: string | null;
  commissioning_price_cents: number;
  fluid_form_price_cents: number;
  fluid_form_policy: "complement" | "always";
  default_electric_length_m: number;
}

export interface SiteInfo {
  one_way_km: number | null;
  same_commune: boolean;
  parking_enabled: boolean;
  parking_per_day_cents: number | null;
  gainable_access: boolean;
}

export interface CalcContext {
  pricing: PricingSettings;
  lineSettings: LineSettings;
  equipmentOptions: EquipmentOptions;
  travelFor: (laborDays: number) => TravelFee | null;
}

export function calcContext(c: CompanyPricing, site: SiteInfo, coefs: Coefficients, w: WizardState): CalcContext {
  const pricing: PricingSettings = {
    vatRegime: c.vat_regime,
    laborChargesRate: c.labor_charges_rate,
    materialChargesRate: c.material_charges_rate,
    targetMarginPerDayCents: c.target_margin_per_day_cents,
  };
  const lineSettings: LineSettings = {
    vatRate: c.vat_regime === "franchise" ? 0 : c.default_vat_rate || DEFAULT_VAT_RATE,
    dailyLaborRateCents: c.daily_labor_rate_cents,
    commissioningPriceCents: c.commissioning_price_cents,
    fluidFormPriceCents: c.fluid_form_price_cents,
    fluidFormPolicy: c.fluid_form_policy,
    defaultElectricM: c.default_electric_length_m,
    companyAccessoryCoefficient: c.accessory_sale_coefficient,
    accessoryPurchaseCoefficient: c.accessory_purchase_coefficient,
    materialCoefficient: w.materialCoefficient ?? null,
    accessoryCoefficient: w.accessoryCoefficient ?? null,
  };
  const travelFor = (laborDays: number): TravelFee | null => {
    if (site.one_way_km === null && !site.same_commune) return null;
    return computeTravelFee(
      {
        oneWayKm: site.one_way_km ?? 0,
        sameCommune: site.same_commune,
        trips: laborDays,
        parking: { enabled: site.parking_enabled, perDayCents: site.parking_per_day_cents ?? c.parking_per_day_cents },
      },
      { pricePerKmCents: c.travel_price_per_km_cents, minimumFeeCents: c.travel_minimum_fee_cents, minimumDailyWithParkingCents: c.travel_min_daily_with_parking_cents },
    );
  };
  return {
    pricing,
    lineSettings,
    equipmentOptions: { sizing: coefs.sizing, multiSimultaneity: coefs.sizing.multiSimultaneity, gainableAccess: site.gainable_access },
    travelFor,
  };
}

export function proposalInput(ctx: CalcContext, c: CompanyPricing, coefs: Coefficients, rooms: RoomNeed[], products: CatProduct[], accessories: CatAccessory[]): ProposalInput {
  return {
    rooms,
    products,
    accessories,
    equipmentOptions: ctx.equipmentOptions,
    lineSettings: ctx.lineSettings,
    pricing: ctx.pricing,
    laborParams: coefs.laborDays,
    travelFor: ctx.travelFor,
    preferredBrandId: c.preferred_brand_id,
  };
}
