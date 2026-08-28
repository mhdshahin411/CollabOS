import OpenAI from "openai";
import type { Deal, DealPriority } from "@/lib/types";

// gpt-4o-mini: cheap + reliable structured-output extraction. Swap this one
// constant for "gpt-5-mini" / "gpt-5-nano" (cheaper) if you want a newer model.
const MODEL = "gpt-4o-mini";

let client: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!client) {
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
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
- "is_deal": false for spam, fan mail, newsletters, or anything unrelated to brand deals.
- "brand_name": the company or brand pitching. null if not identifiable.
- "budget": total offered amount as a plain number, no symbols. null if not stated.
- "currency": ISO 4217 code (e.g. "USD") when stated or clearly implied, else null.
- "deliverables": short strings, e.g. ["1x Instagram Reel", "3x Stories"]. Empty list if none stated.
- "deadline": content/delivery deadline as YYYY-MM-DD, resolving relative dates against today's date (provided). null if not stated.
- "priority": "high" for large budgets, tight deadlines, or well-known brands; "medium" for typical pitches; "low" for vague or mass outreach.
- "summary": 1-2 sentences a talent manager would write in a CRM.
Extract only what is in the message. Never invent values.`;

// strict:true guarantees the model returns JSON that validates this schema
// exactly. Every field is required (nullable ones use a null union) so the
// result always has the full shape the DB expects.
const DEAL_SCHEMA = {
  name: "extracted_deal",
  strict: true,
  schema: {
    type: "object",
    properties: {
      is_deal: { type: "boolean" },
      brand_name: { type: ["string", "null"] },
      contact_name: { type: ["string", "null"] },
      budget: { type: ["number", "null"] },
      currency: { type: ["string", "null"] },
      deliverables: { type: "array", items: { type: "string" } },
      deadline: { type: ["string", "null"] },
      priority: { type: "string", enum: ["low", "medium", "high"] },
      summary: { type: "string" },
    },
    required: [
      "is_deal",
      "brand_name",
      "contact_name",
      "budget",
      "currency",
      "deliverables",
      "deadline",
      "priority",
      "summary",
    ],
    additionalProperties: false,
  },
} as const;

export async function extractDealFromMessage(
  rawText: string,
  channel: string,
  sender?: string,
): Promise<ExtractedDeal> {
  const today = new Date().toISOString().slice(0, 10);

  const completion = await getOpenAI().chat.completions.create({
    model: MODEL,
    temperature: 0,
    max_completion_tokens: 1024,
    response_format: { type: "json_schema", json_schema: DEAL_SCHEMA },
    messages: [
      { role: "system", content: EXTRACTION_SYSTEM_PROMPT },
      {
        role: "user",
        content: `Channel: ${channel}\nSender: ${sender ?? "unknown"}\nToday's date: ${today}\n\nMessage:\n"""\n${rawText}\n"""`,
      },
    ],
  });

  const choice = completion.choices[0];
  // The model can decline via a `refusal` field instead of returning content —
  // throw so the ingest route returns 502 (retryable) rather than recording junk.
  if (choice?.message?.refusal) {
    throw new Error(`OpenAI refused extraction: ${choice.message.refusal}`);
  }
  const text = choice?.message?.content?.trim();
  if (!text) {
    throw new Error(`OpenAI returned no extraction text (finish_reason=${choice?.finish_reason ?? "none"})`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`OpenAI returned non-JSON output: ${text.slice(0, 200)}`);
  }

  // strict mode validates the schema, but the cast erases types — verify the
  // load-bearing fields before trusting them downstream.
  const d = parsed as Partial<ExtractedDeal>;
  if (typeof d.is_deal !== "boolean" || typeof d.summary !== "string" || !d.priority) {
    throw new Error(`OpenAI output missing required fields: ${text.slice(0, 200)}`);
  }
  return {
    is_deal: d.is_deal,
    brand_name: d.brand_name ?? null,
    contact_name: d.contact_name ?? null,
    budget: d.budget ?? null,
    currency: d.currency ?? null,
    deliverables: d.deliverables ?? [],
    deadline: d.deadline ?? null,
    priority: d.priority,
    summary: d.summary,
  };
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

  const completion = await getOpenAI().chat.completions.create({
    model: MODEL,
    temperature: 0.7,
    max_completion_tokens: 400,
    messages: [
      { role: "system", content: BRIEFING_SYSTEM_PROMPT },
      {
        role: "user",
        content: `Unread deals (JSON):\n${JSON.stringify(dealDigest, null, 2)}\n\nUser's request: ${
          userQuery?.trim() || "Give me my briefing on these deals."
        }`,
      },
    ],
  });

  const text = completion.choices[0]?.message?.content?.trim();
  if (!text) {
    throw new Error(`OpenAI returned no briefing text (finish_reason=${completion.choices[0]?.finish_reason ?? "none"})`);
  }
  return text;
}
