"use client";

import { useCallback, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { DealsProvider } from "@/lib/dealsStore";
import DashboardShell from "./DashboardShell";
import LoginForm from "./LoginForm";

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

  return (
    <DealsProvider>
      <DashboardShell email={session.user.email} onSignOut={signOut} />
    </DealsProvider>
  );
}
