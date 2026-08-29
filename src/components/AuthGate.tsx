"use client";

import { useCallback, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { DealsProvider } from "@/lib/dealsStore";
import DashboardShell from "./DashboardShell";
import LoginForm from "./LoginForm";
import type { ChannelAccounts } from "./SettingsModal";

/**
 * Gates the whole dashboard behind a Supabase session.
 *   loading  -> spinner
 *   no user  -> <LoginForm/>
 *   signed in -> <DealsProvider> + <DashboardShell/>
 */
export default function AuthGate() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = getSupabaseBrowser();
    let mounted = true;
    let sawAuthEvent = false;

    // Failsafe: getSession() can HANG (not just reject) — supabase-js guards
    // session reads with the Web Locks API, which stalls indefinitely in some
    // browser contexts (private windows, cross-tab contention, certain mobile
    // browsers). A hang never triggers .then/.catch, so without this the app is
    // trapped on the loading spinner forever. Clear loading after 3s no matter
    // what; the onAuthStateChange listener still updates the session if it later
    // resolves. Better a login screen than an infinite spinner.
    const failsafe = setTimeout(() => {
      if (mounted) setLoading(false);
    }, 3000);

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!mounted) return;
        if (!sawAuthEvent) setSession(data.session);
        setLoading(false);
      })
      .catch(() => {
        if (mounted) setLoading(false);
      });

    const { data } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (!mounted) return;
      sawAuthEvent = true;
      setSession(newSession);
      setLoading(false);
    });

    return () => {
      mounted = false;
      clearTimeout(failsafe);
      data.subscription.unsubscribe();
    };
  }, []);

  const signOut = useCallback(async () => {
    await getSupabaseBrowser().auth.signOut();
  }, []);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/20 border-t-sky-400" />
      </div>
    );
  }

  if (!session) {
    return <LoginForm />;
  }

  const accounts = (session.user.user_metadata?.channel_accounts ?? {}) as ChannelAccounts;

  return (
    <DealsProvider>
      <DashboardShell email={session.user.email} onSignOut={signOut} accounts={accounts} />
    </DealsProvider>
  );
}
