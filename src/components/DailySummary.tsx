"use client";

import { useCallback, useEffect, useState } from "react";
import { getSupabaseBrowser } from "@/lib/supabase/client";

/**
 * A persistent "today's briefing" card. Reuses /api/voice-summary but with
 * markAsRead:false so simply viewing the summary never clears the unread queue.
 */
export default function DailySummary() {
  const [text, setText] = useState<string | null>(null);
  const [count, setCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const {
        data: { session },
      } = await getSupabaseBrowser().auth.getSession();
      if (!session) {
        setError(true);
        setLoading(false);
        return;
      }
      const res = await fetch("/api/voice-summary", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ markAsRead: false }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const data: { briefing: string; deal_count?: number } = await res.json();
      setText(data.briefing);
      setCount(data.deal_count ?? null);
    } catch (err) {
      console.error("Daily summary failed:", err);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="glass rounded-3xl p-5">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-sky-300">
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
            <path d="M12 3v2M12 19v2M5 5l1.5 1.5M17.5 17.5 19 19M3 12h2M19 12h2M5 19l1.5-1.5M17.5 6.5 19 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            <circle cx="12" cy="12" r="3.5" stroke="currentColor" strokeWidth="1.6" />
          </svg>
          Today&apos;s briefing
          {count != null && count > 0 && (
            <span className="rounded-full bg-sky-500/20 px-2 py-0.5 text-[10px] text-sky-200">{count} unread</span>
          )}
        </h2>
        <button
          onClick={load}
          disabled={loading}
          aria-label="Refresh briefing"
          className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-50"
        >
          <svg className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} viewBox="0 0 24 24" fill="none">
            <path d="M20 11A8 8 0 1 0 18 16.5M20 5v4h-4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      {loading ? (
        <div className="space-y-2">
          <div className="h-3 w-full animate-pulse rounded bg-white/5" />
          <div className="h-3 w-4/5 animate-pulse rounded bg-white/5" />
        </div>
      ) : error ? (
        <p className="text-sm text-rose-300">Couldn&apos;t generate a briefing right now.</p>
      ) : (
        <p className="text-sm leading-relaxed text-slate-200">{text}</p>
      )}
    </section>
  );
}
