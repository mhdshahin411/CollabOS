import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { extractDealFromMessage, type ExtractedDeal } from "@/lib/gemini";
import type { Channel } from "@/lib/types";
import type { SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
// Gemini extraction can take a few seconds; don't let a slow call hit the
// default serverless timeout. (Hobby plan caps maxDuration at 60s.)
export const maxDuration = 60;

/**
 * POST /api/ingest — called by n8n whenever a message arrives on any channel.
 *
 * Expected payload:
 * {
 *   "user_id":             "<CollabOS user uuid the receiving account maps to>",
 *   "channel":             "gmail" | "instagram" | "whatsapp",
 *   "raw_text":            "<full message body>",
 *   "sender":              "brand@acme.com",          // optional
 *   "external_thread_id":  "<gmail threadId / IG conversation id / WA chat id>", // optional
 *   "external_message_id": "<provider message id>",   // strongly recommended — enables retry dedup
 *   "received_at":         "2026-08-27T09:00:00Z"     // optional
 * }
 *
 * n8n retries on any 5xx, so this route is written to be idempotent: a redelivery
 * carrying a known `external_message_id` is a no-op, and the concurrency race on a
 * brand-new thread is recovered rather than 500'd. See the CollabOS audit notes.
 */

interface IngestPayload {
  user_id: string;
  channel: Channel;
  raw_text: string;
  sender?: string;
  external_thread_id?: string;
  external_message_id?: string;
  received_at?: string;
}

const CHANNELS: Channel[] = ["gmail", "instagram", "whatsapp"];

// Build the field patch applied to an existing deal when a deal-related
// follow-up message arrives. Only overwrites fields the new message actually
// carried, and always resurfaces the deal as unread.
function buildFollowUpPatch(extracted: ExtractedDeal): Record<string, unknown> {
  const patch: Record<string, unknown> = { is_read: false, summary: extracted.summary };
  if (extracted.budget != null) patch.budget = extracted.budget;
  if (extracted.currency) patch.currency = extracted.currency;
  if (extracted.deadline) patch.deadline = extracted.deadline;
  if (extracted.deliverables?.length) patch.deliverables = extracted.deliverables;
  return patch;
}

async function applyFollowUp(
  supabase: SupabaseClient,
  dealId: string,
  extracted: ExtractedDeal,
): Promise<boolean> {
  const { error } = await supabase.from("deals").update(buildFollowUpPatch(extracted)).eq("id", dealId);
  if (error) {
    console.error("Deal follow-up update failed:", error);
    return false;
  }
  return true;
}

export async function POST(req: NextRequest) {
  // 1. Authenticate the n8n webhook via shared secret
  const secret = req.headers.get("x-webhook-secret");
  if (!process.env.N8N_WEBHOOK_SECRET || secret !== process.env.N8N_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Validate the payload
  let payload: IngestPayload;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { user_id, channel, raw_text } = payload;
  if (!user_id || !raw_text?.trim() || !CHANNELS.includes(channel)) {
    return NextResponse.json(
      { error: "user_id, channel (gmail|instagram|whatsapp) and raw_text are required" },
      { status: 400 },
    );
  }

  const supabase = getSupabaseAdmin();

  // 3. Idempotency short-circuit: if this exact provider message was already
  // ingested, do nothing — no second Gemini call, no re-flipping is_read.
  // (This is what makes an n8n retry safe.)
  if (payload.external_message_id) {
    const { data: dupe, error: dupeError } = await supabase
      .from("messages")
      .select("deal_id")
      .eq("user_id", user_id)
      .eq("channel", channel)
      .eq("external_message_id", payload.external_message_id)
      .maybeSingle();
    if (dupeError) {
      console.error("Duplicate-message lookup failed:", dupeError);
      return NextResponse.json({ error: "Message lookup failed" }, { status: 503 });
    }
    if (dupe) {
      return NextResponse.json({ deal_id: dupe.deal_id, created: false, duplicate: true });
    }
  }

  // 4. Does this thread already map to a deal? (follow-up vs. new pitch)
  let existingDealId: string | null = null;
  if (payload.external_thread_id) {
    const { data, error: lookupError } = await supabase
      .from("deals")
      .select("id")
      .eq("user_id", user_id)
      .eq("source_channel", channel)
      .eq("external_thread_id", payload.external_thread_id)
      .maybeSingle();
    if (lookupError) {
      // A genuine read failure is NOT "no such thread" — bail out before the
      // Gemini call with a retryable status instead of silently creating a
      // duplicate / dropping the message.
      console.error("Thread lookup failed:", lookupError);
      return NextResponse.json({ error: "Thread lookup failed" }, { status: 503 });
    }
    existingDealId = data?.id ?? null;
  }

  // 5. AI extraction: raw text -> structured deal JSON.
  //    gemini.ts throws on an empty/blocked response, so a safety block or a
  //    thought-only candidate surfaces here as a 502 rather than a silent skip.
  let extracted: ExtractedDeal;
  try {
    extracted = await extractDealFromMessage(raw_text, channel, payload.sender);
  } catch (err) {
    console.error("Gemini extraction failed:", err);
    return NextResponse.json({ error: "AI extraction failed" }, { status: 502 });
  }

  // Not deal-related and not part of an existing thread -> acknowledge and skip.
  // Explicit `=== false` (not falsy): a malformed `{}` would have thrown in gemini.ts.
  if (extracted.is_deal === false && !existingDealId) {
    return NextResponse.json({ skipped: true, reason: "not_deal_related" });
  }

  // 6. Upsert the deal
  let dealId = existingDealId;
  let created = false;
  let dealUpdated = false;

  if (dealId) {
    // Only a deal-related follow-up may mutate the extracted CRM fields.
    // Non-deal traffic on a known thread (auto-replies, unsubscribe footers,
    // signature-only bounces) is still recorded in `messages` below for thread
    // history, but must not clobber the deal's summary or re-flag it unread.
    if (extracted.is_deal) {
      const ok = await applyFollowUp(supabase, dealId, extracted);
      if (!ok) return NextResponse.json({ error: "Failed to update deal" }, { status: 500 });
      dealUpdated = true;
    }
  } else {
    const { data, error } = await supabase
      .from("deals")
      .insert({
        user_id,
        brand_name: extracted.brand_name ?? payload.sender ?? "Unknown brand",
        contact_name: extracted.contact_name,
        budget: extracted.budget,
        currency: extracted.currency ?? "USD",
        deliverables: extracted.deliverables ?? [],
        deadline: extracted.deadline,
        priority: extracted.priority,
        summary: extracted.summary,
        source_channel: channel,
        external_thread_id: payload.external_thread_id ?? null,
      })
      .select("id")
      .single();

    if (error) {
      // 23505 = we lost a race with a concurrent request for the same brand-new
      // thread (deals_user_thread_uidx fired). Recover the winner's id, apply
      // this message's extraction to it, and continue so the raw message is
      // still persisted below.
      if (error.code === "23505" && payload.external_thread_id) {
        const { data: winner, error: reReadError } = await supabase
          .from("deals")
          .select("id")
          .eq("user_id", user_id)
          .eq("source_channel", channel)
          .eq("external_thread_id", payload.external_thread_id)
          .maybeSingle();
        if (reReadError || !winner) {
          console.error("Deal insert conflicted and re-read failed:", reReadError ?? error);
          return NextResponse.json({ error: "Failed to create deal" }, { status: 500 });
        }
        const winnerId = winner.id as string;
        dealId = winnerId;
        if (await applyFollowUp(supabase, winnerId, extracted)) dealUpdated = true;
      } else {
        console.error("Deal insert failed:", error);
        return NextResponse.json({ error: "Failed to create deal" }, { status: 500 });
      }
    } else {
      dealId = data.id;
      created = true;
    }
  }

  // 7. Store the raw message on the thread. Upsert on the provider message id so
  // a concurrent redelivery that slipped past the step-3 check is a silent no-op
  // (DO NOTHING) rather than a duplicate row or a 500 that triggers more retries.
  const { error: msgError } = await supabase.from("messages").upsert(
    {
      deal_id: dealId,
      user_id,
      channel,
      direction: "inbound",
      sender: payload.sender ?? null,
      raw_text,
      external_message_id: payload.external_message_id ?? null,
      external_thread_id: payload.external_thread_id ?? null,
      received_at: payload.received_at ?? new Date().toISOString(),
    },
    { onConflict: "user_id,channel,external_message_id", ignoreDuplicates: true },
  );
  if (msgError && msgError.code !== "23505") {
    console.error("Message insert failed:", msgError);
    return NextResponse.json({ error: "Deal saved but message insert failed" }, { status: 500 });
  }

  return NextResponse.json({
    deal_id: dealId,
    created,
    deal_updated: dealUpdated,
    extracted,
  });
}
