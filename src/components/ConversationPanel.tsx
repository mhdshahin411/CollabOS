"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { useDeals } from "@/lib/dealsStore";
import { CHANNEL_LABELS, STAGES, type Message } from "@/lib/types";
import { formatBudget, ChannelIcon } from "./DealCard";

export default function ConversationPanel() {
  const { selectedDeal: deal, selectDeal } = useDeals();
  const dealId = deal?.id ?? null;

  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(true);
  const [messagesError, setMessagesError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendNote, setSendNote] = useState<string | null>(null);
  const threadEndRef = useRef<HTMLDivElement>(null);

  // Load the raw thread whenever the open deal changes.
  useEffect(() => {
    if (!dealId) return;
    let cancelled = false;
    setLoadingMessages(true);
    setMessagesError(null);
    getSupabaseBrowser()
      .from("messages")
      .select("*")
      .eq("deal_id", dealId)
      .order("received_at", { ascending: true })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
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
  }, [dealId, reloadKey]);

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && selectDeal(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectDeal]);

  // Keep the thread scrolled to the newest message.
  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, loadingMessages]);

  if (!deal) return null;

  const stage = STAGES.find((s) => s.id === deal.stage);
  const budget = formatBudget(deal);

  async function sendReply(e: FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || !deal || sending) return;
    setSending(true);
    setSendNote(null);

    try {
      const {
        data: { session },
      } = await getSupabaseBrowser().auth.getSession();
      if (!session) {
        setSendNote("Sign in again to reply.");
        setSending(false);
        return;
      }

      const res = await fetch("/api/reply", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ deal_id: deal.id, text }),
      });
      const data: {
        message?: Message;
        sent?: boolean;
        send_error?: string | null;
        error?: string;
      } = await res.json();

      if (!res.ok) {
        setSendNote(data.error ?? "Couldn't send. Try again.");
      } else {
        if (data.message) setMessages((prev) => [...prev, data.message as Message]);
        setDraft("");
        setSendNote(data.sent ? "Sent to the brand ✓" : data.send_error ?? "Recorded on the thread.");
      }
    } catch (err) {
      console.error("Failed to send reply:", err);
      setSendNote("Couldn't send. Try again.");
    }
    setSending(false);
  }

  const fields = [
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
    { label: "Channel", value: CHANNEL_LABELS[deal.source_channel] },
  ];

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* scrim */}
      <div className="animate-fade-in absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => selectDeal(null)} />

      <aside className="animate-panel-in panel-solid relative flex h-full w-full max-w-md flex-col rounded-l-3xl">
        {/* Header */}
        <header className="flex items-start justify-between gap-4 border-b border-white/10 p-5">
          <div className="min-w-0">
            <h2 className="truncate font-display text-2xl text-white">{deal.brand_name}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-400">
              {stage && (
                <span className="flex items-center gap-1.5">
                  <span className={`h-1.5 w-1.5 rounded-full ${stage.accent}`} />
                  {stage.label}
                </span>
              )}
              <span>·</span>
              <span className="flex items-center gap-1">
                <ChannelIcon channel={deal.source_channel} className="h-3 w-3" />
                {CHANNEL_LABELS[deal.source_channel]}
              </span>
              {deal.contact_name && (
                <>
                  <span>·</span>
                  <span>{deal.contact_name}</span>
                </>
              )}
            </div>
          </div>
          <button
            onClick={() => selectDeal(null)}
            aria-label="Close"
            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
          >
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
            </svg>
          </button>
        </header>

        <div className="scroll-slim flex-1 space-y-5 overflow-y-auto p-5">
          {/* AI summary */}
          {deal.summary && (
            <section className="bg-slate-800 rounded-2xl p-4">
              <h3 className="text-[10px] font-medium uppercase tracking-wider text-sky-300">AI Summary</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-200">{deal.summary}</p>
            </section>
          )}

          {/* Extracted fields */}
          <section className="grid grid-cols-2 gap-2.5">
            {fields.map((f) => (
              <div key={f.label} className="bg-slate-800 rounded-xl p-3">
                <p className="text-[10px] uppercase tracking-wider text-slate-500">{f.label}</p>
                <p className="mt-0.5 text-sm font-medium capitalize text-slate-100">{f.value}</p>
              </div>
            ))}
          </section>

          {deal.deliverables.length > 0 && (
            <section>
              <h3 className="text-[10px] font-medium uppercase tracking-wider text-slate-500">Deliverables</h3>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {deal.deliverables.map((d, i) => (
                  <span key={i} className="rounded-full bg-white/5 px-2.5 py-1 text-xs text-slate-200 ring-1 ring-white/10">
                    {d}
                  </span>
                ))}
              </div>
            </section>
          )}

          {/* Conversation thread */}
          <section>
            <h3 className="mb-2 text-[10px] font-medium uppercase tracking-wider text-slate-500">Conversation</h3>
            <div className="space-y-2.5">
              {loadingMessages && <div className="bg-slate-800 h-16 animate-pulse rounded-2xl" />}

              {!loadingMessages && messagesError && (
                <div role="alert" className="flex items-center gap-3 rounded-2xl border border-rose-500/30 bg-rose-500/10 px-3 py-2.5 text-sm text-rose-200">
                  <span>Couldn&apos;t load the thread.</span>
                  <button onClick={() => setReloadKey((k) => k + 1)} className="ml-auto rounded-lg border border-rose-400/40 px-2 py-0.5 text-xs">
                    Retry
                  </button>
                </div>
              )}

              {!loadingMessages && !messagesError && messages.length === 0 && (
                <p className="text-sm text-slate-500">No messages stored for this deal yet.</p>
              )}

              {messages.map((msg) => {
                const outbound = msg.direction === "outbound";
                return (
                  <div key={msg.id} className={`flex ${outbound ? "justify-end" : "justify-start"}`}>
                    <div
                      className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm ${
                        outbound
                          ? "rounded-br-md bg-sky-500/85 text-white"
                          : "bg-slate-800 rounded-bl-md text-slate-200"
                      }`}
                    >
                      <div className={`mb-1 flex items-center gap-2 text-[10px] ${outbound ? "text-sky-100/80" : "text-slate-400"}`}>
                        <span className="font-medium">{outbound ? "You" : msg.sender ?? "Brand"}</span>
                        <span>{new Date(msg.received_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                      </div>
                      <p className="whitespace-pre-wrap leading-relaxed">{msg.raw_text}</p>
                    </div>
                  </div>
                );
              })}
              <div ref={threadEndRef} />
            </div>
          </section>
        </div>

        {/* Composer */}
        <form onSubmit={sendReply} className="border-t border-white/10 p-3">
          <div className="bg-slate-800 flex items-end gap-2 rounded-2xl p-1.5">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void sendReply(e as unknown as FormEvent);
                }
              }}
              rows={1}
              placeholder="Write a reply…"
              className="max-h-28 flex-1 resize-none bg-transparent px-2.5 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500"
            />
            <button
              type="submit"
              disabled={sending || !draft.trim()}
              className="shrink-0 rounded-xl bg-sky-500 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-sky-400 disabled:opacity-40"
            >
              {sending ? "…" : "Send"}
            </button>
          </div>
          {sendNote ? (
            <p className={`px-2 pt-1.5 text-[10px] ${sendNote.includes("✓") ? "text-emerald-400" : "text-slate-500"}`}>{sendNote}</p>
          ) : (
            <p className="px-2 pt-1.5 text-[10px] text-slate-500">Gmail replies send to the brand on the original thread. Other channels are recorded only.</p>
          )}
        </form>
      </aside>
    </div>
  );
}
