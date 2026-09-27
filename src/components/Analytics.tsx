"use client";

import { useMemo, useState } from "react";
import { useDeals } from "@/lib/dealsStore";
import { dealCurrency, formatMoney, totalsByCurrency } from "@/lib/money";
import { STAGES, CHANNEL_LABELS, type Channel } from "@/lib/types";

const STAGE_COLORS: Record<string, string> = {
  new_pitch: "#38bdf8",
  negotiating: "#fbbf24",
  drafting: "#a78bfa",
  completed: "#34d399",
};
const CHANNEL_COLORS: Record<Channel, string> = {
  gmail: "#f87171",
  instagram: "#e879f9",
  whatsapp: "#34d399",
};

function ValueByStage() {
  const { deals } = useDeals();
  const [hover, setHover] = useState<number | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  // Amounts in different currencies can't share one scale, so the card shows
  // one currency at a time (most-used first) with a switch when there are more.
  const currencies = totalsByCurrency(deals).map((t) => t.currency);
  const currency = picked && currencies.includes(picked) ? picked : (currencies[0] ?? "USD");
  const rows = STAGES.map((s) => {
    const stageDeals = deals.filter((d) => d.stage === s.id);
    return {
      ...s,
      value: stageDeals
        .filter((d) => d.budget != null && dealCurrency(d) === currency)
        .reduce((sum, d) => sum + (d.budget ?? 0), 0),
      count: stageDeals.length,
    };
  });
  const max = Math.max(1, ...rows.map((r) => r.value));

  return (
    <div className="glass-card rounded-3xl p-5">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h3 className="text-xs font-medium uppercase tracking-wider text-slate-400">Value by stage</h3>
        {currencies.length > 1 && (
          <div className="flex gap-1" role="group" aria-label="Currency">
            {currencies.map((c) => (
              <button
                key={c}
                onClick={() => setPicked(c)}
                aria-pressed={c === currency}
                className={`rounded-md px-1.5 py-0.5 text-[10px] font-medium transition-colors ${
                  c === currency ? "bg-white/15 text-white" : "text-slate-400 hover:text-slate-200"
                }`}
              >
                {c}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="space-y-3">
        {rows.map((r, i) => (
          <div key={r.id} className="relative" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="text-slate-300">{r.label}</span>
              <span className="font-display text-sm text-slate-100">{formatMoney(r.value, currency, { compact: true })}</span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-white/5">
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{
                  width: `${(r.value / max) * 100}%`,
                  background: STAGE_COLORS[r.id],
                  opacity: hover === null || hover === i ? 1 : 0.4,
                  boxShadow: hover === i ? `0 0 12px ${STAGE_COLORS[r.id]}` : "none",
                }}
              />
            </div>
            {hover === i && (
              <span className="mt-1 block text-[11px] text-slate-400">
                {r.count} deal{r.count === 1 ? "" : "s"}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function ChannelDonut() {
  const { deals } = useDeals();
  const [hover, setHover] = useState<Channel | null>(null);
  const channels = Object.keys(CHANNEL_LABELS) as Channel[];
  const data = channels
    .map((c) => ({ channel: c, count: deals.filter((d) => d.source_channel === c).length }))
    .filter((d) => d.count > 0);
  const total = data.reduce((s, d) => s + d.count, 0);

  const R = 42;
  const C = 2 * Math.PI * R;
  let offset = 0;
  const segments = data.map((d) => {
    const frac = total ? d.count / total : 0;
    const seg = { ...d, dash: frac * C, offset };
    offset += frac * C;
    return seg;
  });

  const focused = hover ? data.find((d) => d.channel === hover) : null;

  return (
    <div className="glass-card rounded-3xl p-5">
      <h3 className="mb-4 text-xs font-medium uppercase tracking-wider text-slate-400">Deals by channel</h3>
      <div className="flex items-center gap-5">
        <div className="relative h-32 w-32 shrink-0">
          <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
            <circle cx="50" cy="50" r={R} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="12" />
            {segments.map((s) => (
              <circle
                key={s.channel}
                cx="50"
                cy="50"
                r={R}
                fill="none"
                stroke={CHANNEL_COLORS[s.channel]}
                strokeWidth={hover === s.channel ? 15 : 12}
                strokeDasharray={`${s.dash} ${C - s.dash}`}
                strokeDashoffset={-s.offset}
                strokeLinecap="butt"
                className="cursor-pointer transition-all duration-200"
                style={{ opacity: hover === null || hover === s.channel ? 1 : 0.35 }}
                onMouseEnter={() => setHover(s.channel)}
                onMouseLeave={() => setHover(null)}
              />
            ))}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="font-display text-2xl text-white">{focused ? focused.count : total}</span>
            <span className="text-[10px] uppercase tracking-wide text-slate-500">
              {focused ? CHANNEL_LABELS[focused.channel] : "total"}
            </span>
          </div>
        </div>
        <div className="flex-1 space-y-2">
          {data.length === 0 && <p className="text-sm text-slate-500">No deals yet.</p>}
          {data.map((d) => (
            <button
              key={d.channel}
              onMouseEnter={() => setHover(d.channel)}
              onMouseLeave={() => setHover(null)}
              className="flex w-full items-center gap-2 text-left text-xs"
            >
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: CHANNEL_COLORS[d.channel] }} />
              <span className="flex-1 text-slate-300">{CHANNEL_LABELS[d.channel]}</span>
              <span className="tabular-nums text-slate-400">{d.count}</span>
              <span className="w-10 text-right tabular-nums text-slate-500">
                {total ? Math.round((d.count / total) * 100) : 0}%
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function PriorityMix() {
  const { deals } = useDeals();
  const [hover, setHover] = useState<string | null>(null);
  const order: { key: "high" | "medium" | "low"; label: string; color: string }[] = [
    { key: "high", label: "High", color: "#fb7185" },
    { key: "medium", label: "Medium", color: "#fbbf24" },
    { key: "low", label: "Low", color: "#94a3b8" },
  ];
  const counts = order.map((o) => ({ ...o, count: deals.filter((d) => d.priority === o.key).length }));
  const total = Math.max(1, deals.length);

  return (
    <div className="glass-card rounded-3xl p-5">
      <h3 className="mb-4 text-xs font-medium uppercase tracking-wider text-slate-400">Priority mix</h3>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-white/5">
        {counts.map((c) => (
          <div
            key={c.key}
            onMouseEnter={() => setHover(c.key)}
            onMouseLeave={() => setHover(null)}
            className="h-full transition-all duration-300"
            style={{
              width: `${(c.count / total) * 100}%`,
              background: c.color,
              opacity: hover === null || hover === c.key ? 1 : 0.4,
            }}
          />
        ))}
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2">
        {counts.map((c) => (
          <div
            key={c.key}
            onMouseEnter={() => setHover(c.key)}
            onMouseLeave={() => setHover(null)}
            className={`rounded-xl p-2.5 text-center transition-colors ${hover === c.key ? "bg-white/10" : ""}`}
          >
            <span className="mx-auto mb-1 block h-2 w-2 rounded-full" style={{ background: c.color }} />
            <span className="font-display block text-xl text-white">{c.count}</span>
            <span className="text-[10px] uppercase tracking-wide text-slate-500">{c.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Analytics() {
  const { loading } = useDeals();
  const cards = useMemo(() => [ValueByStage, ChannelDonut, PriorityMix], []);
  if (loading) {
    return (
      <div className="grid gap-4 md:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="glass-soft h-48 animate-pulse rounded-3xl" />
        ))}
      </div>
    );
  }
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {cards.map((C, i) => (
        <C key={i} />
      ))}
    </div>
  );
}
