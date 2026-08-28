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
      {
        auth: {
          // Bypass supabase-js's default navigator.locks-based session lock,
          // which can stall session reads/refreshes indefinitely in some
          // browser contexts (private windows, cross-tab contention, certain
          // mobile browsers) — the cause of the app hanging on the loading
          // spinner. A no-op lock is safe for a single-tab web app.
          lock: async (_name, _acquireTimeout, fn) => fn(),
        },
      },
    );
  }
  return browserClient;
}
