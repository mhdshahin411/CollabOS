"use client";

import { useDeals, type ChannelFilter } from "@/lib/dealsStore";
import { STAGES, CHANNEL_LABELS, type Channel } from "@/lib/types";
import { ChannelIcon } from "./DealCard";

const CHANNELS: Channel[] = ["gmail", "instagram", "whatsapp"];

function currency(n: number): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      notation: n >= 100000 ? "compact" : "standard",
      maximumFractionDigits: n >= 100000 ? 1 : 0,
    }).format(n);
  } catch {
    return `$${n}`;
  }
}

export default function Sidebar({ email, onSignOut }: { email?: string; onSignOut: () => void }) {
  const { deals, channelFilter, setChannelFilter } = useDeals();

  const totalValue = deals.reduce((s, d) => s + (d.budget ?? 0), 0);
  const unread = deals.filter((d) => !d.is_read).length;
  const active = deals.filter((d) => d.stage !== "completed").length;
  const maxStage = Math.max(1, ...STAGES.map((s) => deals.filter((d) => d.stage === s.id).length));

  const channelCount = (c: ChannelFilter) =>
    c === "all" ? deals.length : deals.filter((d) => d.source_channel === c).length;

  return (
    <aside className="glass flex flex-col gap-6 rounded-3xl p-5 lg:h-[calc(100vh-4rem)] lg:sticky lg:top-8">
      {/* Brand */}
      <div className="px-1 pt-1">
        <h1 className="font-display text-2xl text-white">CollabOS</h1>
        <div className="mt-1 h-px w-16 bg-gradient-to-r from-white/40 to-transparent" />
        <p className="mt-2 text-xs text-slate-400">AI deal pipeline</p>
      </div>

      {/* Pipeline value */}
      <div className="glass-soft rounded-2xl p-4">
        <p className="text-[10px] uppercase tracking-wider text-slate-400">Pipeline value</p>
        <p className="font-display mt-1 text-4xl leading-none text-white">{currency(totalValue)}</p>
        <div className="mt-3 flex items-center gap-4 text-xs text-slate-400">
          <span>
            <span className="text-slate-100">{active}</span> active
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-sky-400" />
            <span className="text-slate-100">{unread}</span> unread
          </span>
        </div>
      </div>

      {/* Stage distribution */}
      <div>
        <p className="mb-2.5 px-1 text-[10px] uppercase tracking-wider text-slate-500">Stages</p>
        <div className="space-y-2.5">
          {STAGES.map((stage) => {
            const count = deals.filter((d) => d.stage === stage.id).length;
            return (
              <div key={stage.id} className="flex items-center gap-2.5">
                <span className={`h-2 w-2 shrink-0 rounded-full ${stage.accent}`} />
                <span className="w-24 shrink-0 truncate text-xs text-slate-300">{stage.label}</span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/5">
                  <div
                    className={`h-full rounded-full ${stage.accent} opacity-80`}
                    style={{ width: `${(count / maxStage) * 100}%` }}
                  />
                </div>
                <span className="w-4 shrink-0 text-right text-xs tabular-nums text-slate-400">{count}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Channel filter */}
      <div>
        <p className="mb-2.5 px-1 text-[10px] uppercase tracking-wider text-slate-500">Channels</p>
        <div className="space-y-1">
          {(["all", ...CHANNELS] as ChannelFilter[]).map((c) => {
            const isActive = channelFilter === c;
            return (
              <button
                key={c}
                onClick={() => setChannelFilter(c)}
                className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm transition-colors ${
                  isActive ? "bg-white/10 text-white ring-1 ring-white/15" : "text-slate-300 hover:bg-white/5"
                }`}
              >
                {c === "all" ? (
                  <span className="grid h-3.5 w-3.5 place-items-center text-slate-400">◎</span>
                ) : (
                  <ChannelIcon channel={c} />
                )}
                <span className="flex-1 text-left">{c === "all" ? "All channels" : CHANNEL_LABELS[c]}</span>
                <span className="text-xs tabular-nums text-slate-500">{channelCount(c)}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* User */}
      <div className="mt-auto flex items-center gap-2.5 border-t border-white/10 pt-4">
        <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-sky-500/20 text-sm font-medium text-sky-200 ring-1 ring-sky-400/30">
          {(email?.[0] ?? "?").toUpperCase()}
        </div>
        <span className="min-w-0 flex-1 truncate text-xs text-slate-400">{email ?? "Signed in"}</span>
        <button
          onClick={onSignOut}
          className="rounded-lg border border-white/10 px-2.5 py-1 text-xs text-slate-300 transition-colors hover:border-white/20 hover:text-white"
        >
          Sign out
        </button>
      </div>
    </aside>
  );
}
