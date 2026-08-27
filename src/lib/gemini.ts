import { GoogleGenAI, Type } from "@google/genai";
import type { Deal, DealPriority } from "@/lib/types";

// gemini-2.5-flash is no longer available to new API users; Google's API now
// points new projects to gemini-3.6-flash. Same generateContent interface.
const MODEL = "gemini-3.6-flash";

let client: GoogleGenAI | null = null;
function getGemini(): GoogleGenAI {
  if (!client) {
    client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
  }
  return client;
}

// ---------------------------------------------------------------------------
// 1. Deal extraction (ingestion pipeline)
// ---------------------------------------------------------------------------

export interface ExtractedDeal {
  is_deal: boolean;
  brand_name: string | null;
  contact_name: string | null;
  budget: number | null;
  currency: string | null;
  deliverables: string[];
  deadline: string | null; // YYYY-MM-DD
  priority: DealPriority;
  summary: string;
}

const EXTRACTION_SYSTEM_PROMPT = `You are the intake engine for CollabOS, a CRM for social media influencers.
You receive one raw inbound message (email, Instagram DM, or WhatsApp message).
Decide whether it is brand-collaboration related and extract structured fields.

Rules:
- "is_deal": false for spam, fan mail, or anything unrelated to brand deals.
- "brand_name": the company or brand pitching. null if not identifiable.
- "budget": total offered amount as a plain number, no symbols. null if not stated.
- "currency": ISO 4217 code (e.g. "USD") when stated or clearly implied, else null.
- "deliverables": short strings, e.g. ["1x Instagram Reel", "3x Stories"]. Empty list if none stated.
- "deadline": content/delivery deadline as YYYY-MM-DD, resolving relative dates against today's date (provided). null if not stated.
- "priority": "high" for large budgets, tight deadlines, or well-known brands; "medium" for typical pitches; "low" for vague or mass outreach.
- "summary": 1-2 sentences a talent manager would write in a CRM.
Extract only what is in the message. Never invent values.`;

const extractionSchema = {
  type: Type.OBJECT,
  properties: {
    is_deal: { type: Type.BOOLEAN },
    brand_name: { type: Type.STRING, nullable: true },
    contact_name: { type: Type.STRING, nullable: true },
    budget: { type: Type.NUMBER, nullable: true },
    currency: { type: Type.STRING, nullable: true },
    deliverables: { type: Type.ARRAY, items: { type: Type.STRING } },
    deadline: { type: Type.STRING, nullable: true },
    priority: { type: Type.STRING, enum: ["low", "medium", "high"] },
    summary: { type: Type.STRING },
  },
  required: ["is_deal", "deliverables", "priority", "summary"],
};

export async function extractDealFromMessage(
  rawText: string,
  channel: string,
  sender?: string,
): Promise<ExtractedDeal> {
  const today = new Date().toISOString().slice(0, 10);
  const response = await getGemini().models.generateContent({
    model: MODEL,
    contents: `Channel: ${channel}\nSender: ${sender ?? "unknown"}\nToday's date: ${today}\n\nMessage:\n"""\n${rawText}\n"""`,
    config: {
      systemInstruction: EXTRACTION_SYSTEM_PROMPT,
      responseMimeType: "application/json",
      responseSchema: extractionSchema,
      temperature: 0.1,
    },
  });

  // `response.text` is `undefined` for a safety block, a thought-only candidate,
  // or MAX_TOKENS reached mid-thinking — NOT just on error. Never let a no-text
  // response become a valid-looking `{}`: throw so the ingest route returns 502
  // (retryable) instead of silently recording a "not a deal" success.
  const text = response.text?.trim();
  if (!text) {
    const finish = response.candidates?.[0]?.finishReason;
    const block = response.promptFeedback?.blockReason;
    throw new Error(
      `Gemini returned no extraction text (finishReason=${finish ?? "none"}, blockReason=${block ?? "none"})`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`Gemini returned non-JSON output: ${text.slice(0, 200)}`);
  }

  // The cast below erases any shape mismatch, so verify the required fields
  // rather than trust them — a partial object would fail on a DB constraint
  // deeper in the stack with a far less obvious error.
  const d = parsed as Partial<ExtractedDeal>;
  if (typeof d.is_deal !== "boolean" || typeof d.summary !== "string" || !d.priority) {
    throw new Error(`Gemini output missing required fields: ${text.slice(0, 200)}`);
  }
  return d as ExtractedDeal;
}

// ---------------------------------------------------------------------------
// 2. Voice briefing (talent-manager-style spoken summary)
// ---------------------------------------------------------------------------

const BRIEFING_SYSTEM_PROMPT = `You are the user's sharp, upbeat talent manager giving a spoken morning briefing.
The output is read aloud by text-to-speech, so:
- Plain conversational sentences only. No markdown, bullets, emojis, or headings.
- Keep it under 120 words.
- Lead with the headline numbers (how many new deals, total money on the table).
- Call out high-priority deals and tight deadlines by brand name.
- End with one concrete suggested next action.
If the user asked a specific question, answer it using the deal data provided.`;

export async function generateVoiceBriefing(
  deals: Deal[],
  userQuery?: string,
): Promise<string> {
  const dealDigest = deals.map((d) => ({
    brand: d.brand_name,
    budget: d.budget,
    currency: d.currency,
    deliverables: d.deliverables,
    deadline: d.deadline,
    priority: d.priority,
    stage: d.stage,
    channel: d.source_channel,
    summary: d.summary,
  }));

  const response = await getGemini().models.generateContent({
    model: MODEL,
    contents: `Unread deals (JSON):\n${JSON.stringify(dealDigest, null, 2)}\n\nUser's request: ${
      userQuery?.trim() || "Give me my briefing on these deals."
    }`,
    config: {
      systemInstruction: BRIEFING_SYSTEM_PROMPT,
      temperature: 0.7,
    },
  });

  // `!text` (not `??`) is load-bearing: the text getter can return the empty
  // string `''` for an empty text part, and `''` is not caught by `??`. Throw on
  // both `''` and `undefined` so the route returns 502 and, crucially, does NOT
  // fall through to marking every unread deal as read on a failed generation.
  const text = response.text?.trim();
  if (!text) {
    throw new Error(
      `Gemini returned no briefing text (finishReason=${response.candidates?.[0]?.finishReason ?? "none"})`,
    );
  }
  return text;
}
