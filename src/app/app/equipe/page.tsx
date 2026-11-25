import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentCompany } from "@/lib/company/current";
import { loadBilling } from "@/lib/billing/load";
import { seatCheck } from "@/lib/billing/access";
import { TeamManager } from "./TeamManager";

export const metadata: Metadata = { title: "Mon équipe" };

export default async function TeamPage() {
  const { supabase, company, role, user } = await getCurrentCompany();
  if (role !== "admin") redirect("/app");
  const [billing, { data: members }, { data: invites }] = await Promise.all([
    loadBilling(supabase),
    supabase.from("profiles").select("id, email, full_name, access_role, role").order("created_at"),
    supabase.from("invitations").select("id, email, access_role, expires_at, token").is("accepted_at", null).order("created_at"),
  ]);
  const seats = seatCheck(billing.access, billing.members + billing.pendingInvites);
  return (
    <div className="space-y-6">
      <Link href="/app/parametres" className="text-lg font-bold text-brand underline underline-offset-4">
        ← Paramètres
      </Link>
      <h1 className="text-3xl font-extrabold">Mon équipe</h1>
      <TeamManager
        me={user.id}
        members={(members ?? []).map((m) => ({ id: m.id, email: m.email ?? "", name: m.full_name ?? "", role: m.access_role, owner: m.role === "owner" }))}
        invites={(invites ?? []).map((i) => ({ id: i.id, email: i.email, role: i.access_role, expired: new Date(i.expires_at) < new Date(), token: i.token }))}
        seats={{ used: billing.members + billing.pendingInvites, max: billing.access.maxUsers, ok: seats.ok, message: seats.message, upgradeTo: seats.upgradeTo }}
        planInterval={billing.row.interval ?? "month"}
        launchOffer={billing.row.launch_offer}
        marginsVisible={company.technicians_see_margins}
        appUrl={process.env.NEXT_PUBLIC_APP_URL ?? ""}
      />
    </div>
  );
}
