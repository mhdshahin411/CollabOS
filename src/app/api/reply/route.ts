import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { CHANNEL_LABELS, type Channel, type DeliveryStatus } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * POST /api/reply — send an outbound reply on a deal's thread.
 *
 * Headers: Authorization: Bearer <supabase access token>
 * Body:    { "deal_id": "<uuid>", "text": "<reply body>" }
 *
 * Records the reply in `messages` with a `delivery_status`, and (for Gmail
 * deals) forwards it to the n8n "Outbound Reply" webhook at
 * N8N_OUTBOUND_WEBHOOK_URL, which sends it as a real Gmail reply on the
 * original thread using the connected Gmail account.
 */

// Well inside maxDuration, so a hung send still ends with a recorded outcome
// instead of the function being killed mid-request.
const SEND_TIMEOUT_MS = 15_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) {
    return NextResponse.json({ error: "Missing Authorization header" }, { status: 401 });
  }

  const supabase = getSupabaseAdmin();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(token);
  if (authError || !user) {
    return NextResponse.json({ error: "Invalid or expired session" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { deal_id: dealId, text: rawText } = (body ?? {}) as { deal_id?: unknown; text?: unknown };
  const text = typeof rawText === "string" ? rawText.trim() : "";
  if (typeof dealId !== "string" || !UUID_RE.test(dealId) || !text) {
    return NextResponse.json({ error: "deal_id and text are required" }, { status: 400 });
  }

  // The deal, scoped to this user (never let a user reply on someone else's deal).
  const { data: deal, error: dealErr } = await supabase
    .from("deals")
    .select("id, user_id, source_channel")
    .eq("id", dealId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (dealErr) {
    console.error("Reply: deal lookup failed:", dealErr);
    return NextResponse.json({ error: "Lookup failed" }, { status: 503 });
  }
  if (!deal) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }

  // The message we're replying to (latest inbound on the thread).
  const { data: lastInbound, error: inboundErr } = await supabase
    .from("messages")
    .select("external_message_id")
    .eq("deal_id", dealId)
    .eq("user_id", user.id)
    .eq("direction", "inbound")
    .order("received_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (inboundErr) {
    console.error("Reply: thread lookup failed:", inboundErr);
    return NextResponse.json({ error: "Lookup failed" }, { status: 503 });
  }

  // Can this reply actually be sent? If not, it's saved as a labeled note.
  const channel = deal.source_channel as Channel;
  const webhookUrl = process.env.N8N_OUTBOUND_WEBHOOK_URL;
  const secret = process.env.N8N_WEBHOOK_SECRET;
  const originalId: string | null = lastInbound?.external_message_id ?? null;
  let noteReason: string | null = null;
  if (channel !== "gmail") {
    noteReason = `Sending isn't wired for ${CHANNEL_LABELS[channel]} yet — saved as a note.`;
  } else if (!originalId) {
    noteReason = "No original email to reply to — saved as a note.";
  } else if (!webhookUrl || !secret) {
    noteReason = "Sending isn't configured (N8N_OUTBOUND_WEBHOOK_URL) — saved as a note.";
  }

  // Record before sending, so a send that dies mid-flight leaves an
  // "unconfirmed" row rather than nothing (or a reply that looks delivered).
  const { data: saved, error: saveErr } = await supabase
    .from("messages")
    .insert({
      deal_id: dealId,
      user_id: user.id,
      channel,
      direction: "outbound",
      sender: "You",
      raw_text: text,
      delivery_status: noteReason ? "not_sent" : "unconfirmed",
    })
    .select("*")
    .single();
  if (saveErr) {
    console.error("Reply: failed to record message:", saveErr);
    return NextResponse.json({ error: "Failed to record reply" }, { status: 500 });
  }

  if (noteReason) {
    return NextResponse.json({ message: saved, recorded: true, sent: false, send_error: noteReason });
  }

  let status: DeliveryStatus;
  let sendError: string | null = null;
  try {
    const res = await fetch(webhookUrl!, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-webhook-secret": secret!,
      },
      body: JSON.stringify({
        channel: "gmail",
        message_id: originalId,
        text,
        deal_id: dealId,
      }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    status = res.ok ? "sent" : "failed";
    if (!res.ok) {
      sendError = `Send service returned ${res.status} — is the Outbound workflow active?`;
    }
  } catch (err) {
    console.error("Reply: outbound send failed:", err);
    // After a timeout n8n may still send it; other errors mean the request
    // most likely never arrived.
    const timedOut = (err as { name?: string } | null)?.name === "TimeoutError";
    status = timedOut ? "unconfirmed" : "failed";
    sendError = timedOut
      ? "The send service didn't answer in time — check Gmail before resending."
      : "Couldn't reach the send service.";
  }

  const { data: updated, error: updateErr } = await supabase
    .from("messages")
    .update({ delivery_status: status })
    .eq("id", saved.id)
    .select("*")
    .single();
  if (updateErr) console.error("Reply: failed to record delivery status:", updateErr);

  return NextResponse.json({
    message: updated ?? { ...saved, delivery_status: status },
    recorded: true,
    sent: status === "sent",
    send_error: sendError,
  });
}
