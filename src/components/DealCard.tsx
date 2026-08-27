"use client";

import type { DragEvent } from "react";
import { CHANNEL_LABELS, type Deal } from "@/lib/types";

const PRIORITY_STYLES: Record<Deal["priority"], string> = {
  high: "bg-rose-500/15 text-rose-400 ring-rose-500/30",
  medium: "bg-amber-500/15 text-amber-400 ring-amber-500/30",
  low: "bg-slate-500/15 text-slate-400 ring-slate-500/30",
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

interface DealCardProps {
  deal: Deal;
  isDragging: boolean;
  onClick: () => void;
  onDragStart: (e: DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
}

export default function DealCard({
  deal,
  isDragging,
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
      className={`cursor-grab rounded-lg border border-slate-800 bg-slate-900 p-3 shadow-sm transition-all hover:border-slate-700 hover:bg-slate-800/80 active:cursor-grabbing ${
        isDragging ? "rotate-1 opacity-50" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-medium text-slate-100">
          {!deal.is_read && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-sky-400" />}
          {deal.brand_name}
        </p>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ring-1 ${PRIORITY_STYLES[deal.priority]}`}
        >
          {deal.priority}
        </span>
      </div>

      {deal.summary && (
        <p className="mt-1.5 line-clamp-2 text-xs text-slate-400">{deal.summary}</p>
      )}

      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
        {budget && <span className="font-medium text-emerald-400">{budget}</span>}
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
        <span className="ml-auto text-slate-600">{CHANNEL_LABELS[deal.source_channel]}</span>
      </div>
    </div>
  );
}
