import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { generateVoiceBriefing, type ActivityItem } from "@/lib/ai";
import type { Deal } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/voice-summary — called by the Voice Briefing module.
 *
 * Headers:  Authorization: Bearer <supabase access token>
 * Body:     { "query"?: string, "markAsRead"?: boolean }   (both optional)
 *
 * Fetches the user's unread deals and asks OpenAI for a short,
 * talent-manager-style spoken briefing. The client plays it via TTS.
 */
export async function POST(req: NextRequest) {
  // 1. Authenticate the caller with their Supabase session token
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

  const { query, markAsRead = true } = await req
    .json()
    .catch(() => ({}) as { query?: string; markAsRead?: boolean });
  const question = query?.trim();
  const isQuestion = !!question;

  // 2. Unread deals — the "new" queue that drives the briefing count + mark-read.
  const { data: unread, error } = await supabase
    .from("deals")
    .select("*")
    .eq("user_id", user.id)
    .eq("is_read", false)
    .order("priority", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) {
    console.error("Failed to fetch unread deals:", error);
    return NextResponse.json({ error: "Failed to fetch deals" }, { status: 500 });
  }

  // For a QUESTION, give the assistant the full recent picture (all recent
  // deals + message activity), not just unread — so it can actually answer
  // things like "what's the last activity?" instead of a canned briefing.
  let contextDeals = (unread ?? []) as Deal[];
  let recentActivity: ActivityItem[] = [];
  if (isQuestion) {
    const { data: recent } = await supabase
      .from("deals")
      .select("*")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false })
      .limit(25);
    if (recent?.length) contextDeals = recent as Deal[];

    const { data: msgs } = await supabase
      .from("messages")
      .select("channel, direction, sender, raw_text, received_at")
      .eq("user_id", user.id)
      .order("received_at", { ascending: false })
      .limit(15);
    recentActivity = (msgs ?? []).map((m) => ({
      channel: m.channel as string,
      direction: m.direction as string,
      sender: (m.sender as string | null) ?? null,
      text: ((m.raw_text as string) ?? "").slice(0, 200),
      at: m.received_at as string,
    }));
  }

  // Only "all caught up" for a plain briefing with no unread deals — never
  // swallow an actual question.
  if (!isQuestion && !unread?.length) {
    return NextResponse.json({
      briefing: "You're all caught up. No new deals since your last check-in.",
      deal_count: 0,
    });
  }

  // 3. OpenAI answers the question, or produces the daily briefing.
  let briefing: string;
  try {
    briefing = await generateVoiceBriefing(contextDeals, question, recentActivity);
  } catch (err) {
    console.error("OpenAI briefing failed:", err);
    return NextResponse.json({ error: "Failed to generate briefing" }, { status: 502 });
  }

  // 4. Mark unread deals as read only for a plain daily briefing — asking a
  // question must not silently clear the unread queue.
  if (markAsRead && !isQuestion && unread?.length) {
    const { error: readErr } = await supabase
      .from("deals")
      .update({ is_read: true })
      .in("id", unread.map((d) => d.id));
    if (readErr) console.error("Failed to mark deals read:", readErr);
  }

  return NextResponse.json({ briefing, deal_count: unread?.length ?? 0 });
}
