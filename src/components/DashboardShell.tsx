"use client";

import { useDeals } from "@/lib/dealsStore";
import Sidebar from "./Sidebar";
import KanbanBoard from "./KanbanBoard";
import DailySummary from "./DailySummary";
import Analytics from "./Analytics";
import VoiceAssistant from "./VoiceAssistant";
import ConversationPanel from "./ConversationPanel";

function HeroStatus() {
  const { deals, loading } = useDeals();
  const unread = deals.filter((d) => !d.is_read).length;
  const hot = deals.filter((d) => !d.is_read && d.priority === "high").length;

  const headline = loading
    ? "Loading your pipeline…"
    : unread === 0
      ? "You're all caught up"
      : hot > 0
        ? `${hot} hot pitch${hot > 1 ? "es" : ""} need you`
        : `${unread} new pitch${unread > 1 ? "es" : ""} waiting`;

  return <p className="font-display text-3xl leading-tight text-white sm:text-4xl">{headline}</p>;
}

export default function DashboardShell({ email, onSignOut }: { email?: string; onSignOut: () => void }) {
  const { query, setQuery } = useDeals();

  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="mx-auto min-h-screen max-w-[1400px] px-4 pb-36 pt-8 sm:px-6 lg:px-8">
      <div className="lg:grid lg:grid-cols-[300px_1fr] lg:gap-6">
        <Sidebar email={email} onSignOut={onSignOut} />

        <main className="mt-6 space-y-6 lg:mt-0">
          {/* Top bar */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-slate-400">{today}</p>
            <div className="glass-soft flex items-center gap-2 rounded-full px-3 py-2">
              <svg className="h-4 w-4 text-slate-400" viewBox="0 0 20 20" fill="none">
                <circle cx="9" cy="9" r="6" stroke="currentColor" strokeWidth="1.5" />
                <path d="m14 14 3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search deals…"
                className="w-32 bg-transparent text-sm text-slate-100 outline-none placeholder:text-slate-500 sm:w-44 sm:focus:w-56"
                style={{ transition: "width 200ms ease" }}
              />
            </div>
          </div>

          {/* Hero */}
          <section className="glass flex flex-wrap items-center justify-between gap-4 rounded-3xl px-6 py-5">
            <HeroStatus />
            <p className="max-w-xs text-right text-sm leading-relaxed text-slate-400">
              Every pitch, DM and email — extracted by AI into one live pipeline.
            </p>
          </section>

          {/* Daily briefing summary */}
          <DailySummary />

          {/* Interactive analytics */}
          <Analytics />

          {/* Pipeline */}
          <KanbanBoard />
        </main>
      </div>

      {/* Floating overlays */}
      <VoiceAssistant />
      <ConversationPanel />
    </div>
  );
}
