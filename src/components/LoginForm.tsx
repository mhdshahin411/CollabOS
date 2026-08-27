"use client";

import { useState, type FormEvent } from "react";
import { getSupabaseBrowser } from "@/lib/supabase/client";

/**
 * Email + password sign-in. On success, Supabase persists the session and
 * AuthGate's onAuthStateChange listener swaps this view for the dashboard —
 * so there's no navigation to do here.
 */
export default function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const { error } = await getSupabaseBrowser().auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (error) {
        // Distinguish "wrong credentials" from an infra/network failure so we
        // don't tell an offline user their (correct) password is wrong. Keep
        // the credentials message generic to avoid email enumeration.
        const status = (error as { status?: number }).status;
        if (error.name === "AuthRetryableFetchError" || status === 429 || (status ?? 0) >= 500) {
          setError("Couldn't reach the server. Check your connection and try again.");
        } else {
          setError("Invalid email or password.");
        }
      }
      // Success: AuthGate reacts to the auth state change and unmounts this form.
    } catch {
      // signInWithPassword re-throws non-Auth errors (e.g. fetch unavailable);
      // without this the button would stay stuck on "Signing in…".
      setError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-white">CollabOS</h1>
          <p className="mt-1 text-sm text-slate-400">Sign in to your pipeline</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="space-y-4 rounded-xl border border-slate-800 bg-slate-900/60 p-6"
        >
          <div>
            <label htmlFor="email" className="mb-1.5 block text-xs font-medium text-slate-300">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none transition-colors placeholder:text-slate-600 focus:border-sky-500"
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label htmlFor="password" className="mb-1.5 block text-xs font-medium text-slate-300">
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none transition-colors placeholder:text-slate-600 focus:border-sky-500"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <p role="alert" className="text-sm text-rose-400">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-lg bg-sky-500 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
