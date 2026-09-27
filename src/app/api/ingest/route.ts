import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { extractDealFromMessage, type ExtractedDeal } from "@/lib/ai";
import type { Channel } from "@/lib/types";
import type { SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
// OpenAI extraction can take a few seconds; don't let a slow call hit the
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
 * brand-new thread is recovered rather than 500'd. Problems a retry can't fix
 * (a malformed payload, an unknown user) get a 4xx so n8n stops retrying.
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
const OPTIONAL_FIELDS = ["sender", "external_thread_id", "external_message_id", "received_at"] as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Compare digests so the check takes the same time however much of the secret matches.
function secretMatches(given: string | null, expected: string): boolean {
  if (!given) return false;
  const digest = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(digest(given), digest(expected));
}

// Returns the payload, or an error message for a 400.
function parsePayload(body: unknown): IngestPayload | string {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "Body must be a JSON object";
  const b = body as Record<string, unknown>;
  if (typeof b.user_id !== "string" || !UUID_RE.test(b.user_id)) return "user_id must be a UUID";
  if (!CHANNELS.includes(b.channel as Channel)) return "channel must be gmail, instagram or whatsapp";
  if (typeof b.raw_text !== "string" || !b.raw_text.trim()) return "raw_text is required";

  const payload: IngestPayload = { user_id: b.user_id, channel: b.channel as Channel, raw_text: b.raw_text };
  for (const key of OPTIONAL_FIELDS) {
    const v = b[key];
    // n8n sends "" for a field its source didn't have. Stored as-is, a blank
    // thread id collides on deals_user_thread_uidx (every later thread-less
    // message 500s) and a blank message id makes every later message look like
    // a duplicate that gets dropped — so blank means absent.
    if (v == null || (typeof v === "string" && !v.trim())) continue;
    if (typeof v !== "string" && typeof v !== "number") return `${key} must be a string`;
    payload[key] = String(v).trim();
  }
  return payload;
}

// A bad timestamp shouldn't cost us the message: log it and use now instead.
function receivedAt(payload: IngestPayload): string {
  if (payload.received_at) {
    const ms = Date.parse(payload.received_at);
    if (!Number.isNaN(ms)) return new Date(ms).toISOString();
    console.warn("Ignoring unparseable received_at:", payload.received_at);
  }
  return new Date().toISOString();
}

function findStoredMessage(supabase: SupabaseClient, payload: IngestPayload) {
  return supabase
    .from("messages")
    .select("deal_id")
    .eq("user_id", payload.user_id)
    .eq("channel", payload.channel)
    .eq("external_message_id", payload.external_message_id!)
    .maybeSingle();
}

// Build the field patch applied to an existing deal when a deal-related
// follow-up message arrives. Only overwrites fields the new message actually
// carried, and always resurfaces the deal as unread.
function buildFollowUpPatch(extracted: ExtractedDeal): Record<string, unknown> {
  const patch: Record<string, unknown> = { is_read: false };
  if (extracted.summary) patch.summary = extracted.summary;
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

async function discardDeal(supabase: SupabaseClient, dealId: string): Promise<void> {
  const { error } = await supabase.from("deals").delete().eq("id", dealId);
  if (error) console.error("Failed to discard orphaned deal:", error);
}

export async function POST(req: NextRequest) {
  // 1. Authenticate the n8n webhook via shared secret
  const expectedSecret = process.env.N8N_WEBHOOK_SECRET;
  if (!expectedSecret || !secretMatches(req.headers.get("x-webhook-secret"), expectedSecret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Validate the payload
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const payload = parsePayload(body);
  if (typeof payload === "string") {
    return NextResponse.json({ error: payload }, { status: 400 });
  }
  const { user_id, channel, raw_text } = payload;

  const supabase = getSupabaseAdmin();

  // 3. Idempotency short-circuit: if this exact provider message was already
  // ingested, do nothing — no second OpenAI call, no re-flipping is_read.
  // (This is what makes an n8n retry safe.)
  if (payload.external_message_id) {
    const { data: dupe, error: dupeError } = await findStoredMessage(supabase, payload);
    if (dupeError) {
      console.error("Duplicate-message lookup failed:", dupeError);
      return NextResponse.json({ error: "Message lookup failed" }, { status: 503 });
    }
    if (dupe) {
      return NextResponse.json({ deal_id: dupe.deal_id, created: false, duplicate: true });
    }
  }

  // 4. Does this thread already map to a deal? (follow-up vs. new pitch)
  let existingDeal: { id: string; summary: string | null } | null = null;
  if (payload.external_thread_id) {
    const { data, error: lookupError } = await supabase
      .from("deals")
      .select("id, summary")
      .eq("user_id", user_id)
      .eq("source_channel", channel)
      .eq("external_thread_id", payload.external_thread_id)
      .maybeSingle();
    if (lookupError) {
      // A genuine read failure is NOT "no such thread" — bail out before the
      // OpenAI call with a retryable status instead of silently creating a
      // duplicate / dropping the message.
      console.error("Thread lookup failed:", lookupError);
      return NextResponse.json({ error: "Thread lookup failed" }, { status: 503 });
    }
    existingDeal = data;
  }

  // 5. AI extraction: raw text -> structured deal JSON. A follow-up gets the
  //    deal's current summary so the model updates it instead of replacing it
  //    with a summary of this one message. ai.ts throws on a refusal or an
  //    empty/malformed response, which surfaces here as a retryable 502.
  let extracted: ExtractedDeal;
  try {
    extracted = await extractDealFromMessage(raw_text, channel, payload.sender, existingDeal?.summary ?? undefined);
  } catch (err) {
    console.error("OpenAI extraction failed:", err);
    return NextResponse.json({ error: "AI extraction failed" }, { status: 502 });
  }

  // Not deal-related and not part of an existing thread -> acknowledge and skip.
  // Explicit `=== false` (not falsy): a malformed `{}` would have thrown in ai.ts.
  if (extracted.is_deal === false && !existingDeal) {
    return NextResponse.json({ skipped: true, reason: "not_deal_related" });
  }

  // 6. Upsert the deal
  let dealId = existingDeal?.id ?? null;
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
      } else if (error.code === "23503") {
        // Foreign-key violation: user_id isn't a CollabOS user. Retrying won't help.
        console.warn("Ingest for unknown user_id:", user_id);
        return NextResponse.json({ error: "Unknown user_id" }, { status: 400 });
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
  const { data: stored, error: msgError } = await supabase
    .from("messages")
    .upsert(
      {
        deal_id: dealId,
        user_id,
        channel,
        direction: "inbound",
        sender: payload.sender ?? null,
        raw_text,
        external_message_id: payload.external_message_id ?? null,
        external_thread_id: payload.external_thread_id ?? null,
        received_at: receivedAt(payload),
      },
      { onConflict: "user_id,channel,external_message_id", ignoreDuplicates: true },
    )
    .select("id");

  // A deal this request created without a thread id can only be found through
  // this request, so an n8n retry would create a second one. If the message
  // didn't land on it, discard it. (A threaded deal is kept: a retry finds it
  // by thread id, and a concurrent message may already be attached to it.)
  const orphanable = created && !payload.external_thread_id;
  const duplicate = msgError?.code === "23505" || (!msgError && !stored?.length);

  if (msgError && !duplicate) {
    console.error("Message insert failed:", msgError);
    if (orphanable) await discardDeal(supabase, dealId!);
    return NextResponse.json({ error: "Message insert failed" }, { status: 500 });
  }
  if (duplicate) {
    // A concurrent redelivery of this same message stored it first.
    if (orphanable) await discardDeal(supabase, dealId!);
    const { data: winner } = await findStoredMessage(supabase, payload);
    return NextResponse.json({ deal_id: winner?.deal_id ?? null, created: false, duplicate: true });
  }

  return NextResponse.json({
    deal_id: dealId,
    created,
    deal_updated: dealUpdated,
    extracted,
  });
}
