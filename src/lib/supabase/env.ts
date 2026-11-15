export function supabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error("Variables NEXT_PUBLIC_SUPABASE_URL et NEXT_PUBLIC_SUPABASE_ANON_KEY manquantes (voir .env.example)");
  }
  return { url, anonKey };
}

/** Bucket privé des logos et tampons : fichiers rangés sous {company_id}/… */
export const ASSETS_BUCKET = "company-assets";
