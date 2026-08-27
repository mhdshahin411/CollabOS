import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let browserClient: SupabaseClient | null = null;

/**
 * Browser-side Supabase client (anon key + user session).
 * RLS is the security boundary for everything this client touches.
 */
export function getSupabaseBrowser(): SupabaseClient {
  if (!browserClient) {
    browserClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
  }
  return browserClient;
}
