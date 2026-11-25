import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ASSETS_BUCKET } from "@/lib/supabase/env";

/** URL signée (1 h) d'une image privée de l'entreprise, ou null. */
export async function signedAssetUrl(supabase: SupabaseClient, path: string | null): Promise<string | null> {
  if (!path) return null;
  const { data } = await supabase.storage.from(ASSETS_BUCKET).createSignedUrl(path, 3600);
  return data?.signedUrl ?? null;
}
