"use client";

import type { DragEvent } from "react";
import { CHANNEL_LABELS, type Channel, type Deal } from "@/lib/types";

const PRIORITY_STYLES: Record<Deal["priority"], string> = {
  high: "bg-rose-400/15 text-rose-300 ring-rose-300/25",
  medium: "bg-amber-400/15 text-amber-200 ring-amber-300/25",
  low: "bg-slate-400/10 text-slate-300 ring-slate-300/20",
};

export function formatBudget(deal: Deal): string | null {
  if (deal.budget == null) return null;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: deal.currency ?? "USD",
      maximumFractionDigits: 0,
    }).format(deal.budget);
  } catch {
    return `${deal.budget} ${deal.currency ?? ""}`.trim();
  }
}

export function ChannelIcon({ channel, className = "h-3.5 w-3.5" }: { channel: Channel; className?: string }) {
  if (channel === "gmail") {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
        <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h15A1.5 1.5 0 0 1 21 6.5v11a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5v-11Z" stroke="currentColor" strokeWidth="1.5" />
        <path d="m4 7 8 6 8-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (channel === "instagram") {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
        <rect x="3.5" y="3.5" width="17" height="17" rx="5" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="12" cy="12" r="3.75" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="16.8" cy="7.2" r="1" fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <path d="M12 3.5a8.5 8.5 0 0 0-7.4 12.7L3.5 20.5l4.4-1.1A8.5 8.5 0 1 0 12 3.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

interface DealCardProps {
  deal: Deal;
  isDragging: boolean;
  isActive: boolean;
  onClick: () => void;
  onDragStart: (e: DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
}

export default function DealCard({
  deal,
  isDragging,
  isActive,
  onClick,
  onDragStart,
  onDragEnd,
}: DealCardProps) {
  const budget = formatBudget(deal);

  return (
    <div
      draggable
      onClick={onClick}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={`glass-card group cursor-grab rounded-2xl p-3.5 active:cursor-grabbing ${
        isDragging ? "rotate-1 opacity-50" : ""
      } ${isActive ? "!border-sky-400/40 ring-1 ring-sky-400/30" : ""}`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-medium text-white">
          {!deal.is_read && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-sky-400 shadow-[0_0_8px] shadow-sky-400/60" />}
          {deal.brand_name}
        </p>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ring-1 ${PRIORITY_STYLES[deal.priority]}`}
        >
          {deal.priority}
        </span>
      </div>

      {deal.summary && (
        <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-slate-300/80">{deal.summary}</p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400/80">
        {budget && <span className="font-display text-sm text-emerald-300">{budget}</span>}
        {deal.deliverables.length > 0 && (
          <span>
            {deal.deliverables.length} deliverable{deal.deliverables.length > 1 ? "s" : ""}
          </span>
        )}
        {deal.deadline && (
          <span>
            Due{" "}
            {new Date(`${deal.deadline}T00:00:00`).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
            })}
          </span>
        )}
        <span className="ml-auto flex items-center gap-1 text-slate-400/70" title={CHANNEL_LABELS[deal.source_channel]}>
          <ChannelIcon channel={deal.source_channel} />
        </span>
      </div>
    </div>
  );
}
