import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { generateVoiceBriefing } from "@/lib/ai";
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

  // 2. Fetch unread deals (cap the digest so the prompt stays small)
  const { data: deals, error } = await supabase
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

  if (!deals?.length) {
    return NextResponse.json({
      briefing: "You're all caught up. No new deals since your last check-in.",
      deal_count: 0,
    });
  }

  // 3. OpenAI turns the deal digest into a spoken briefing
  let briefing: string;
  try {
    briefing = await generateVoiceBriefing(deals as Deal[], query);
  } catch (err) {
    console.error("OpenAI briefing failed:", err);
    return NextResponse.json({ error: "Failed to generate briefing" }, { status: 502 });
  }

  // 4. Mark the briefed deals as read (a failed write must not report success)
  if (markAsRead) {
    const { error: readErr } = await supabase
      .from("deals")
      .update({ is_read: true })
      .in("id", deals.map((d) => d.id));
    if (readErr) console.error("Failed to mark deals read:", readErr);
  }

  return NextResponse.json({ briefing, deal_count: deals.length });
}
