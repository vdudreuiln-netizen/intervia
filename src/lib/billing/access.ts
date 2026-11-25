/**
 * Droits d'accès selon l'abonnement : essai de 14 jours, abonné, lecture seule.
 * Même règle que la fonction SQL company_can_write() (garde-fou en base).
 */
import { PLANS, TRIAL_MAX_USERS, type Interval, type PlanId } from "./plans";

export interface SubscriptionRow {
  status: string; // trialing | active | past_due | canceled | unpaid | incomplete | expired…
  trial_ends_at: string;
  plan: PlanId | null;
  interval: Interval | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  launch_offer: boolean;
  stripe_subscription_id: string | null;
}

export type AccessMode = "trial" | "active" | "past_due" | "read_only";

export interface Access {
  mode: AccessMode;
  canWrite: boolean;
  trialDaysLeft: number | null;
  maxUsers: number;
  plan: PlanId | null;
  message: string | null;
}

const DAY = 86_400_000;

export function accessState(s: SubscriptionRow, now: Date): Access {
  const trialEnd = new Date(s.trial_ends_at).getTime();
  const plan = s.plan;
  if (s.status === "active") {
    const msg = s.cancel_at_period_end && s.current_period_end ? `Abonnement résilié : accès jusqu'au ${new Date(s.current_period_end).toLocaleDateString("fr-FR")}.` : null;
    return { mode: "active", canWrite: true, trialDaysLeft: null, maxUsers: plan ? PLANS[plan].maxUsers : 1, plan, message: msg };
  }
  if (s.status === "past_due") {
    return { mode: "past_due", canWrite: true, trialDaysLeft: null, maxUsers: plan ? PLANS[plan].maxUsers : 1, plan, message: "Paiement en échec : mettez à jour votre carte pour éviter la suspension." };
  }
  if (s.status === "trialing" && trialEnd > now.getTime()) {
    const left = Math.ceil((trialEnd - now.getTime()) / DAY);
    const subscribed = !!s.stripe_subscription_id;
    return {
      mode: "trial",
      canWrite: true,
      trialDaysLeft: left,
      maxUsers: subscribed && plan ? PLANS[plan].maxUsers : TRIAL_MAX_USERS,
      plan,
      message: subscribed ? `Abonnement ${plan ? PLANS[plan].name : ""} : premier paiement à la fin de l'essai, dans ${left} jour(s).` : `Essai gratuit : encore ${left} jour(s).`,
    };
  }
  return {
    mode: "read_only",
    canWrite: false,
    trialDaysLeft: 0,
    maxUsers: 0,
    plan,
    message: s.status === "trialing" ? "Votre essai est terminé : vos devis restent consultables, abonnez-vous pour en créer de nouveaux." : "Abonnement inactif : vos devis restent consultables, réactivez l'abonnement pour en créer de nouveaux.",
  };
}

/**
 * Peut-on ajouter un utilisateur ? Sinon, formule supérieure à proposer.
 * `seats` = membres + invitations en attente.
 */
export function seatCheck(access: Access, seats: number): { ok: boolean; upgradeTo: PlanId | null; message: string | null } {
  if (!access.canWrite) return { ok: false, upgradeTo: null, message: "Abonnement inactif." };
  if (seats < access.maxUsers) return { ok: true, upgradeTo: null, message: null };
  const upgradeTo = access.mode === "trial" && !access.plan ? null : access.plan === "solo" ? "equipe" : access.plan === "equipe" ? "entreprise" : null;
  return {
    ok: false,
    upgradeTo,
    message: upgradeTo
      ? `Votre formule ${access.plan ? PLANS[access.plan].name : ""} est limitée à ${access.maxUsers} utilisateur(s). Passez à la formule ${PLANS[upgradeTo].name} pour inviter plus de collègues.`
      : `Limite de ${access.maxUsers} utilisateurs atteinte.`,
  };
}
