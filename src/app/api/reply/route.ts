import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * POST /api/reply — send an outbound reply on a deal's thread.
 *
 * Headers: Authorization: Bearer <supabase access token>
 * Body:    { "deal_id": "<uuid>", "text": "<reply body>" }
 *
 * Records the reply in `messages`, and (for Gmail deals) forwards it to the
 * n8n "Outbound Reply" webhook, which sends it as a real Gmail reply on the
 * original thread using the connected Gmail account.
 */
const REPLY_WEBHOOK =
  process.env.N8N_OUTBOUND_WEBHOOK_URL || "https://shain411.app.n8n.cloud/webhook/collabos-reply";

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

  let body: { deal_id?: string; text?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const dealId = body.deal_id;
  const text = body.text?.trim();
  if (!dealId || !text) {
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
  const { data: lastInbound } = await supabase
    .from("messages")
    .select("external_message_id")
    .eq("deal_id", dealId)
    .eq("direction", "inbound")
    .order("received_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Record the outbound message on the thread.
  const { data: saved, error: saveErr } = await supabase
    .from("messages")
    .insert({
      deal_id: dealId,
      user_id: user.id,
      channel: deal.source_channel,
      direction: "outbound",
      sender: "You",
      raw_text: text,
    })
    .select("*")
    .single();
  if (saveErr) {
    console.error("Reply: failed to record message:", saveErr);
    return NextResponse.json({ error: "Failed to record reply" }, { status: 500 });
  }

  // Actually send — Gmail only for now, and only if we know which message to reply to.
  let sent = false;
  let sendError: string | null = null;

  if (deal.source_channel !== "gmail") {
    sendError = "Sending is only wired for Gmail right now — reply recorded.";
  } else if (!lastInbound?.external_message_id) {
    sendError = "No original email to reply to — reply recorded.";
  } else if (!process.env.N8N_WEBHOOK_SECRET) {
    sendError = "Send service not configured.";
  } else {
    try {
      const res = await fetch(REPLY_WEBHOOK, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-webhook-secret": process.env.N8N_WEBHOOK_SECRET,
        },
        body: JSON.stringify({
          channel: "gmail",
          message_id: lastInbound.external_message_id,
          text,
          deal_id: dealId,
        }),
      });
      sent = res.ok;
      if (!res.ok) {
        sendError = `Send service returned ${res.status} — is the Outbound workflow active?`;
      }
    } catch (err) {
      console.error("Reply: outbound send failed:", err);
      sendError = "Couldn't reach the send service.";
    }
  }

  return NextResponse.json({ message: saved, recorded: true, sent, send_error: sendError });
}
