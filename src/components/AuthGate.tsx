"use client";

import { useCallback, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import KanbanBoard from "./KanbanBoard";
import VoiceBriefing from "./VoiceBriefing";
import LoginForm from "./LoginForm";

/**
 * Gates the whole dashboard behind a Supabase session.
 *   - loading  -> spinner
 *   - no user  -> <LoginForm/>
 *   - signed in -> the dashboard (header + board), with a sign-out control.
 *
 * The browser Supabase client persists the session and attaches the user's JWT
 * to every REST/realtime call, so once signed in, RLS `auth.uid()` resolves to
 * this user and the board shows only their deals.
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
        // Don't clobber a newer session the listener may have already set
        // (e.g. a sign-out in another tab that resolved before this promise).
        if (!sawAuthEvent) setSession(data.session);
        setLoading(false);
      })
      .catch(() => {
        // A blocked/failed session read (e.g. Web Locks contention in a private
        // window) must fall through to the login form, not hang on the spinner.
        if (mounted) setLoading(false);
      });

    // Fires on sign-in, sign-out, and token refresh — authoritative once seen.
    const { data } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (!mounted) return;
      sawAuthEvent = true;
      setSession(newSession);
      setLoading(false); // covers the ordering where this arrives before getSession
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
      <div className="flex min-h-screen items-center justify-center bg-slate-950">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-700 border-t-sky-400" />
      </div>
    );
  }

  if (!session) {
    return <LoginForm />;
  }

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">CollabOS</h1>
          <p className="mt-1 text-sm text-slate-400">Every pitch, DM and email — one pipeline.</p>
        </div>
        <div className="flex items-center gap-4">
          <VoiceBriefing />
          <div className="flex items-center gap-2 border-l border-slate-800 pl-4">
            <span className="hidden text-xs text-slate-500 sm:inline">{session.user.email}</span>
            <button
              onClick={signOut}
              className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:border-slate-600 hover:text-white"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>
      <KanbanBoard />
    </main>
  );
}
