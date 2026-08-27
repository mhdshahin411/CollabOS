"use client";

import { useEffect, useState } from "react";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { CHANNEL_LABELS, STAGES, type Deal, type Message } from "@/lib/types";
import { formatBudget } from "./DealCard";

interface DealDetailsModalProps {
  deal: Deal;
  onClose: () => void;
}

export default function DealDetailsModal({ deal, onClose }: DealDetailsModalProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(true);
  const [messagesError, setMessagesError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // Load the raw message history behind this deal
  useEffect(() => {
    let cancelled = false;
    setLoadingMessages(true);
    setMessagesError(null);
    getSupabaseBrowser()
      .from("messages")
      .select("*")
      .eq("deal_id", deal.id)
      .order("received_at", { ascending: true })
      .then(({ data, error }) => {
        if (cancelled) return; // modal closed or deal changed mid-flight
        if (error) {
          // A failed/denied query must not masquerade as "no messages".
          console.error("Failed to load messages:", error);
          setMessagesError(error.message);
        } else {
          setMessages((data as Message[]) ?? []);
        }
        setLoadingMessages(false);
      });
    return () => {
      cancelled = true;
    };
  }, [deal.id, reloadKey]);

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const stage = STAGES.find((s) => s.id === deal.stage);
  const budget = formatBudget(deal);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-slate-800 bg-slate-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <header className="flex items-start justify-between gap-4 border-b border-slate-800 p-5">
          <div>
            <h2 className="text-lg font-semibold text-white">{deal.brand_name}</h2>
            <div className="mt-1 flex items-center gap-2 text-xs text-slate-400">
              {stage && (
                <span className="flex items-center gap-1.5">
                  <span className={`h-1.5 w-1.5 rounded-full ${stage.accent}`} />
                  {stage.label}
                </span>
              )}
              <span>·</span>
              <span>{CHANNEL_LABELS[deal.source_channel]}</span>
              {deal.contact_name && (
                <>
                  <span>·</span>
                  <span>{deal.contact_name}</span>
                </>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-300"
            aria-label="Close"
          >
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
            </svg>
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-5">
          {/* AI-extracted summary */}
          {deal.summary && (
            <section className="rounded-lg border border-sky-500/20 bg-sky-500/5 p-4">
              <h3 className="text-xs font-medium uppercase tracking-wide text-sky-400">
                AI Summary
              </h3>
              <p className="mt-1.5 text-sm text-slate-300">{deal.summary}</p>
            </section>
          )}

          {/* Extracted fields */}
          <section className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: "Budget", value: budget ?? "—" },
              {
                label: "Deadline",
                value: deal.deadline
                  ? new Date(`${deal.deadline}T00:00:00`).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })
                  : "—",
              },
              { label: "Priority", value: deal.priority },
              { label: "Deliverables", value: String(deal.deliverables.length) },
            ].map((f) => (
              <div key={f.label} className="rounded-lg bg-slate-800/60 p-3">
                <p className="text-[10px] uppercase tracking-wide text-slate-500">{f.label}</p>
                <p className="mt-0.5 text-sm font-medium capitalize text-slate-200">{f.value}</p>
              </div>
            ))}
          </section>

          {deal.deliverables.length > 0 && (
            <section className="mt-4">
              <h3 className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Deliverables
              </h3>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {deal.deliverables.map((d, i) => (
                  <span
                    key={i}
                    className="rounded-full bg-slate-800 px-2.5 py-1 text-xs text-slate-300"
                  >
                    {d}
                  </span>
                ))}
              </div>
            </section>
          )}

          {/* Raw message history */}
          <section className="mt-5">
            <h3 className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Message History
            </h3>
            <div className="mt-2 space-y-2">
              {loadingMessages && (
                <div className="h-16 animate-pulse rounded-lg bg-slate-800/60" />
              )}
              {!loadingMessages && messagesError && (
                <div
                  role="alert"
                  className="flex items-center gap-3 rounded-lg border border-rose-800 bg-rose-950/40 px-3 py-2.5 text-sm text-rose-200"
                >
                  <span>Couldn&apos;t load message history.</span>
                  <button
                    onClick={() => setReloadKey((k) => k + 1)}
                    className="ml-auto rounded-md border border-rose-700 px-2 py-0.5 text-xs font-medium text-rose-100 transition-colors hover:bg-rose-900/50"
                  >
                    Retry
                  </button>
                </div>
              )}
              {!loadingMessages && !messagesError && messages.length === 0 && (
                <p className="text-sm text-slate-600">No messages stored for this deal.</p>
              )}
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`rounded-lg border p-3 text-sm ${
                    msg.direction === "inbound"
                      ? "border-slate-800 bg-slate-800/40 text-slate-300"
                      : "ml-6 border-sky-500/20 bg-sky-500/5 text-slate-300"
                  }`}
                >
                  <div className="mb-1 flex items-center gap-2 text-[11px] text-slate-500">
                    <span className="font-medium text-slate-400">
                      {msg.direction === "inbound" ? (msg.sender ?? "Brand") : "You"}
                    </span>
                    <span>{new Date(msg.received_at).toLocaleString()}</span>
                  </div>
                  <p className="whitespace-pre-wrap">{msg.raw_text}</p>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
