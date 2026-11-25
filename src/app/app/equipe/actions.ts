"use server";

import { revalidatePath } from "next/cache";
import { getCurrentCompany } from "@/lib/company/current";
import { createAdminClient } from "@/lib/supabase/admin";
import { adminOnlyError, readOnlyError } from "@/lib/billing/guard";
import { loadBilling } from "@/lib/billing/load";
import { seatCheck } from "@/lib/billing/access";
import { appUrl } from "@/lib/billing/stripe";
import { isValidEmail } from "@/lib/company/validation";
import type { PlanId } from "@/lib/billing/plans";

export interface InviteResult {
  ok: boolean;
  message: string;
  link?: string;
  upgradeTo?: PlanId | null;
}

/** Invite un collègue : e-mail Supabase Auth, avec le lien en secours. */
export async function inviteMember(email: string, role: "admin" | "technicien"): Promise<InviteResult> {
  { const g = (await adminOnlyError()) ?? (await readOnlyError()); if (g) return g; }
  const { supabase, company, user } = await getCurrentCompany();
  const clean = email.trim().toLowerCase();
  if (!isValidEmail(clean)) return { ok: false, message: "Adresse e-mail invalide." };
  if (role !== "admin" && role !== "technicien") return { ok: false, message: "Rôle invalide." };

  const billing = await loadBilling(supabase);
  const seats = seatCheck(billing.access, billing.members + billing.pendingInvites);
  if (!seats.ok) return { ok: false, message: seats.message ?? "Limite atteinte.", upgradeTo: seats.upgradeTo };

  const { data: inv, error } = await supabase
    .from("invitations")
    .insert({ company_id: company.id, email: clean, access_role: role, invited_by: user.id })
    .select("token")
    .single();
  if (error) return { ok: false, message: error.code === "23505" ? "Une invitation est déjà en attente pour cette adresse." : "Invitation impossible. Réessayez." };

  const next = `/invitation/${inv.token}`;
  const link = `${appUrl()}${next}`;
  let emailed = false;
  try {
    const { error: mailError } = await createAdminClient().auth.admin.inviteUserByEmail(clean, {
      redirectTo: `${appUrl()}/auth/callback?next=${encodeURIComponent(next)}`,
      data: { invitation_token: inv.token, legal_name: company.legal_name },
    });
    emailed = !mailError;
  } catch {
    emailed = false;
  }
  revalidatePath("/app/equipe");
  return emailed
    ? { ok: true, message: `Invitation envoyée à ${clean}.`, link }
    : { ok: true, message: `Invitation créée. Cette adresse a déjà un compte ou l'e-mail n'a pas pu partir : envoyez-lui ce lien.`, link };
}

export async function revokeInvitation(id: string): Promise<{ ok: boolean; message: string }> {
  { const g = await adminOnlyError(); if (g) return g; }
  const { supabase } = await getCurrentCompany();
  const { error } = await supabase.from("invitations").delete().eq("id", id);
  revalidatePath("/app/equipe");
  return error ? { ok: false, message: "Suppression impossible." } : { ok: true, message: "Invitation annulée." };
}

export async function setMemberRole(userId: string, role: "admin" | "technicien"): Promise<{ ok: boolean; message: string }> {
  { const g = await adminOnlyError(); if (g) return g; }
  const { supabase } = await getCurrentCompany();
  const { error } = await supabase.rpc("set_member_role", { p_user_id: userId, p_role: role });
  revalidatePath("/app/equipe");
  return error ? { ok: false, message: error.message } : { ok: true, message: "Rôle modifié ✔" };
}

export async function removeMember(userId: string): Promise<{ ok: boolean; message: string }> {
  { const g = await adminOnlyError(); if (g) return g; }
  const { supabase } = await getCurrentCompany();
  const { error } = await supabase.rpc("remove_member", { p_user_id: userId });
  revalidatePath("/app/equipe");
  return error ? { ok: false, message: error.message } : { ok: true, message: "Membre retiré : il n'a plus accès à vos devis." };
}

export async function setMarginVisibility(visible: boolean): Promise<{ ok: boolean; message: string }> {
  { const g = await adminOnlyError(); if (g) return g; }
  const { supabase, company } = await getCurrentCompany();
  const { error } = await supabase.from("companies").update({ technicians_see_margins: visible }).eq("id", company.id);
  revalidatePath("/app", "layout");
  return error ? { ok: false, message: "Enregistrement impossible." } : { ok: true, message: visible ? "Les techniciens voient les marges." : "Marges masquées aux techniciens." };
}
