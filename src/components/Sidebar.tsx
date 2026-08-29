"use client";

import { useState } from "react";
import { useDeals, type ChannelFilter } from "@/lib/dealsStore";
import { STAGES, CHANNEL_LABELS, type Channel } from "@/lib/types";
import { ChannelIcon } from "./DealCard";
import SettingsModal, { type ChannelAccounts } from "./SettingsModal";

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

function displayName(email?: string): string {
  if (!email) return "Your workspace";
  const local = email.split("@")[0];
  return local
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function Sidebar({
  email,
  onSignOut,
  accounts = {},
}: {
  email?: string;
  onSignOut: () => void;
  accounts?: ChannelAccounts;
}) {
  const { deals, channelFilter, setChannelFilter } = useDeals();
  const [showSettings, setShowSettings] = useState(false);

  const totalValue = deals.reduce((s, d) => s + (d.budget ?? 0), 0);
  const unread = deals.filter((d) => !d.is_read).length;
  const active = deals.filter((d) => d.stage !== "completed").length;
  const maxStage = Math.max(1, ...STAGES.map((s) => deals.filter((d) => d.stage === s.id).length));

  const channelCount = (c: ChannelFilter) =>
    c === "all" ? deals.length : deals.filter((d) => d.source_channel === c).length;

  return (
    <aside className="glass flex flex-col gap-5 rounded-3xl p-5 lg:sticky lg:top-8 lg:max-h-[calc(100vh-4rem)] lg:overflow-y-auto scroll-slim">
      {/* Brand */}
      <div className="px-1 pt-1">
        <h1 className="font-display text-2xl text-white">CollabOS</h1>
        <div className="mt-1 h-px w-16 bg-gradient-to-r from-white/40 to-transparent" />
      </div>

      {/* Profile */}
      <div className="glass-soft flex items-center gap-3 rounded-2xl p-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-gradient-to-br from-sky-500/40 to-fuchsia-500/30 text-sm font-semibold text-white ring-1 ring-white/15">
          {(email?.[0] ?? "?").toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-white">{displayName(email)}</p>
          <p className="truncate text-[11px] text-slate-400">{email ?? "Signed in"}</p>
        </div>
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

      {/* Connected accounts (also filters the board) */}
      <div>
        <div className="mb-2.5 flex items-center justify-between px-1">
          <p className="text-[10px] uppercase tracking-wider text-slate-500">Connected accounts</p>
          <button
            onClick={() => setShowSettings(true)}
            aria-label="Edit connected accounts"
            className="text-slate-500 transition-colors hover:text-slate-200"
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
              <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" stroke="currentColor" strokeWidth="1.6" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" stroke="currentColor" strokeWidth="1.2" />
            </svg>
          </button>
        </div>
        <div className="space-y-1">
          <button
            onClick={() => setChannelFilter("all")}
            className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm transition-colors ${
              channelFilter === "all" ? "bg-white/10 text-white ring-1 ring-white/15" : "text-slate-300 hover:bg-white/5"
            }`}
          >
            <span className="grid h-3.5 w-3.5 place-items-center text-slate-400">◎</span>
            <span className="flex-1 text-left">All channels</span>
            <span className="text-xs tabular-nums text-slate-500">{channelCount("all")}</span>
          </button>

          {CHANNELS.map((c) => {
            const count = channelCount(c);
            const connected = count > 0;
            const isActive = channelFilter === c;
            // The connected account. Gmail's is the user's login email (the inbox
            // n8n polls); the Instagram handle / WhatsApp number aren't captured
            // in the app yet (they live in the n8n credentials).
            const account = accounts[c] || (connected ? (c === "gmail" ? email : "Linked via n8n") : null);
            return (
              <button
                key={c}
                onClick={() => setChannelFilter(c)}
                className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors ${
                  isActive ? "bg-white/10 ring-1 ring-white/15" : "hover:bg-white/5"
                }`}
              >
                <ChannelIcon channel={c} className="mt-0.5 h-4 w-4 shrink-0 text-slate-300" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 text-sm text-slate-200">
                    {CHANNEL_LABELS[c]}
                    <span className={`text-[10px] ${connected ? "text-emerald-400" : "text-slate-600"}`}>
                      {connected ? "● active" : "○ not linked"}
                    </span>
                  </span>
                  {account && <span className="mt-0.5 block truncate text-[11px] text-slate-500">{account}</span>}
                </span>
                <span className="self-center text-xs tabular-nums text-slate-500">{count}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Sign out */}
      <div className="mt-auto border-t border-white/10 pt-4">
        <button
          onClick={onSignOut}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-xs text-slate-300 transition-colors hover:border-white/20 hover:text-white"
        >
          Sign out
        </button>
      </div>

      {showSettings && <SettingsModal accounts={accounts} onClose={() => setShowSettings(false)} />}
    </aside>
  );
}
