"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { useDeals } from "@/lib/dealsStore";
import { formatBudget } from "@/lib/money";
import { CHANNEL_LABELS, STAGES, type DealStage, type DeliveryStatus, type Message } from "@/lib/types";
import { ChannelIcon } from "./DealCard";

const SETTLED: (DeliveryStatus | null)[] = ["sent", "failed", "not_sent"];

// Insert or replace by id, oldest first. A late "unconfirmed" copy of a reply
// (its realtime INSERT arriving after the send settled) never downgrades it.
function upsertMessage(list: Message[], msg: Message): Message[] {
  const existing = list.find((m) => m.id === msg.id);
  if (existing) {
    if (SETTLED.includes(existing.delivery_status) && msg.delivery_status === "unconfirmed") return list;
    return list.map((m) => (m.id === msg.id ? msg : m));
  }
  return [...list, msg].sort((a, b) => new Date(a.received_at).getTime() - new Date(b.received_at).getTime());
}

function deliveryLabel(msg: Message, pendingId: string | undefined): { text: string; className: string } | null {
  switch (msg.delivery_status) {
    case "sent":
      return { text: "Sent", className: "text-slate-500" };
    case "failed":
      return { text: "Not sent — delivery failed", className: "text-rose-300" };
    case "not_sent":
      return { text: "Saved as a note — not sent", className: "text-slate-400" };
    case "unconfirmed":
      return msg.id === pendingId
        ? { text: "Sending…", className: "text-slate-400" }
        : { text: "Unconfirmed — check Gmail before resending", className: "text-amber-300" };
    default:
      return null;
  }
}

type SendNote = { text: string; tone: "ok" | "info" | "error" };

const NOTE_STYLES: Record<SendNote["tone"], string> = {
  ok: "text-emerald-400",
  info: "text-slate-400",
  error: "text-rose-300",
};

/**
 * The open deal's details and thread. DashboardShell keys it by deal id, so
 * all state here (thread, draft, notes) belongs to exactly one deal.
 */
export default function ConversationPanel() {
  const { selectedDeal: deal, selectDeal, markRead, moveDeal } = useDeals();
  const dealId = deal?.id ?? null;
  const isRead = deal?.is_read ?? true;

  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(true);
  const [messagesError, setMessagesError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendNote, setSendNote] = useState<SendNote | null>(null);
  const threadEndRef = useRef<HTMLDivElement>(null);

  // Opening a deal reads it — and a follow-up that re-flags it unread while
  // the panel is open is read too, since it shows up in the live thread.
  useEffect(() => {
    if (dealId && !isRead) void markRead(dealId);
  }, [dealId, isRead, markRead]);

  // Load the thread and keep it live: new inbound messages and reply status
  // changes arrive over realtime; any that land before the snapshot merge in.
  useEffect(() => {
    if (!dealId) return;
    const supabase = getSupabaseBrowser();
    let cancelled = false;
    setLoadingMessages(true);
    setMessagesError(null);

    const filter = `deal_id=eq.${dealId}`;
    const channel = supabase
      .channel(`thread-${dealId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter }, (p) =>
        setMessages((prev) => upsertMessage(prev, p.new as Message)),
      )
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages", filter }, (p) =>
        setMessages((prev) => upsertMessage(prev, p.new as Message)),
      )
      .subscribe();

    supabase
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
          setMessages((live) => ((data as Message[]) ?? []).reduce(upsertMessage, live));
        }
        setLoadingMessages(false);
      });

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
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
  // The reply currently being sent, so its row reads "Sending…" rather than unconfirmed.
  const pendingId = sending
    ? [...messages].reverse().find((m) => m.direction === "outbound" && m.delivery_status === "unconfirmed")?.id
    : undefined;

  async function sendReply(e?: FormEvent) {
    e?.preventDefault();
    const text = draft.trim();
    if (!text || !deal || sending) return;
    setSending(true);
    setSendNote(null);

    // We can't tell whether the reply went through (connection dropped, the
    // platform timed out). Keep the draft, and reload the thread so a recorded
    // reply shows up with its status — worth checking before resending.
    const unknownOutcome = () => {
      setSendNote({ text: "Couldn't confirm your reply went through — check the thread before resending.", tone: "error" });
      setReloadKey((k) => k + 1);
    };

    try {
      const {
        data: { session },
      } = await getSupabaseBrowser().auth.getSession();
      if (!session) {
        setSendNote({ text: "Sign in again to reply.", tone: "error" });
        return;
      }

      let res: Response;
      try {
        res = await fetch("/api/reply", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ deal_id: deal.id, text }),
        });
      } catch (err) {
        console.error("Failed to send reply:", err);
        unknownOutcome();
        return;
      }
      const data = (await res.json().catch(() => null)) as {
        message?: Message;
        sent?: boolean;
        send_error?: string | null;
        error?: string;
      } | null;

      if (!res.ok || !data) {
        // A JSON error means the route stopped before recording anything.
        if (data?.error) setSendNote({ text: data.error, tone: "error" });
        else unknownOutcome();
        return;
      }

      if (data.message) setMessages((prev) => upsertMessage(prev, data.message as Message));
      setDraft("");
      if (data.sent) {
        setSendNote({ text: "Sent to the brand ✓", tone: "ok" });
      } else {
        const failed = data.message?.delivery_status !== "not_sent";
        setSendNote({ text: data.send_error ?? "Saved as a note.", tone: failed ? "error" : "info" });
      }
    } finally {
      setSending(false);
    }
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

        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          {/* AI summary */}
          {deal.summary && (
            <section className="bg-slate-800 rounded-2xl p-4">
              <h3 className="text-[10px] font-medium uppercase tracking-wider text-sky-300">AI Summary</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-200">{deal.summary}</p>
            </section>
          )}

          {/* Extracted fields + stage (also the keyboard/touch way to move a deal) */}
          <section className="grid grid-cols-2 gap-2.5">
            {fields.map((f) => (
              <div key={f.label} className="bg-slate-800 rounded-xl p-3">
                <p className="text-[10px] uppercase tracking-wider text-slate-500">{f.label}</p>
                <p className="mt-0.5 text-sm font-medium capitalize text-slate-100">{f.value}</p>
              </div>
            ))}
            <label className="bg-slate-800 block rounded-xl p-3">
              <span className="block text-[10px] uppercase tracking-wider text-slate-500">Stage</span>
              <select
                value={deal.stage}
                onChange={(e) => void moveDeal(deal.id, e.target.value as DealStage)}
                className="mt-0.5 w-full cursor-pointer bg-transparent text-sm font-medium text-slate-100 outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60"
              >
                {STAGES.map((s) => (
                  <option key={s.id} value={s.id} className="bg-slate-800">
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
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
                const label = outbound ? deliveryLabel(msg, pendingId) : null;
                const undelivered = msg.delivery_status === "failed" || msg.delivery_status === "not_sent";
                return (
                  <div key={msg.id} className={`flex flex-col ${outbound ? "items-end" : "items-start"}`}>
                    <div
                      className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm ${
                        !outbound
                          ? "bg-slate-800 rounded-bl-md text-slate-200"
                          : undelivered
                            ? "rounded-br-md bg-slate-700 text-slate-100"
                            : "rounded-br-md bg-sky-500/85 text-white"
                      }`}
                    >
                      <div className={`mb-1 flex items-center gap-2 text-[10px] ${outbound && !undelivered ? "text-sky-100/80" : "text-slate-400"}`}>
                        <span className="font-medium">{outbound ? "You" : msg.sender ?? "Brand"}</span>
                        <span>{new Date(msg.received_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                      </div>
                      <p className="whitespace-pre-wrap leading-relaxed">{msg.raw_text}</p>
                    </div>
                    {label && <p className={`mt-1 px-1 text-[10px] ${label.className}`}>{label.text}</p>}
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
                // Enter sends, Shift+Enter adds a line. The Enter that confirms
                // an IME composition (keyCode 229 in Safari) must not send.
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) {
                  e.preventDefault();
                  void sendReply();
                }
              }}
              rows={1}
              placeholder="Write a reply…"
              aria-label="Reply"
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
            <p className={`px-2 pt-1.5 text-[10px] ${NOTE_STYLES[sendNote.tone]}`}>{sendNote.text}</p>
          ) : (
            <p className="px-2 pt-1.5 text-[10px] text-slate-500">Gmail replies go to the brand on the original thread. Other channels are saved as notes.</p>
          )}
        </form>
      </aside>
    </div>
  );
}
