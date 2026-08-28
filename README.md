# CollabOS

AI-powered CRM and unified dashboard for social media influencers. Brand pitches from Gmail, Instagram, and WhatsApp flow into one real-time Kanban pipeline, with a Gemini-powered voice briefing on top.

## Architecture

```
Gmail ─┐
IG DM ─┼─▶ n8n ─▶ POST /api/ingest ─▶ Gemini 2.5 Flash ─▶ Supabase (deals + messages)
WA    ─┘        (x-webhook-secret)    (JSON extraction)         │
                                                                ▼ realtime
                                              Next.js dashboard / Flutter app
                                                                │
                        Mic (STT) ─▶ POST /api/voice-summary ◀──┘
                                       (unread deals + Gemini) ─▶ TTS playback
```

- **Ingestion** — n8n listens on each channel and forwards raw messages to `/api/ingest` with a shared-secret header.
- **AI extraction** — OpenAI (`gpt-4o-mini`, structured JSON output) pulls out brand, budget, deliverables, deadline, priority, and a CRM summary. Non-deal messages (spam, fan mail) are skipped.
- **Threading** — messages carrying a known `external_thread_id` attach to their existing deal (and mark it unread) instead of creating a duplicate.
- **Real-time UI** — the Kanban board subscribes to Supabase `postgres_changes`; new deals appear instantly, drag-and-drop stage moves are optimistic with rollback.
- **Voice briefing** — the mic button captures speech (Web Speech API), `/api/voice-summary` feeds unread deals to Gemini for a talent-manager-style script, and the browser reads it back via `speechSynthesis`.

## Project structure

```
supabase/migrations/0001_init.sql   # deals + messages, RLS, realtime publication
src/
  app/
    page.tsx                        # dashboard (header + voice briefing + board)
    api/ingest/route.ts             # n8n webhook -> Gemini extraction -> Supabase
    api/voice-summary/route.ts      # unread deals -> Gemini spoken briefing
  components/
    KanbanBoard.tsx                 # 4-stage drag-and-drop pipeline, realtime
    DealCard.tsx                    # card UI (budget, priority, deadline, unread dot)
    DealDetailsModal.tsx            # AI summary + raw message history
    VoiceBriefing.tsx               # mic button, STT -> API -> TTS loop
  lib/
    gemini.ts                       # Gemini client, extraction schema, briefing prompt
    supabase/client.ts              # browser client (anon key, RLS enforced)
    supabase/admin.ts               # server-only service-role client
    types.ts                        # Deal / Message / stage definitions
```

## Setup

1. **Install deps**: `npm install`
2. **Supabase**: create a project, then run `supabase/migrations/0001_init.sql` in the SQL editor (or `supabase db push` with the CLI). Enable an auth provider (email is fine) and create your first user.
3. **Env**: `cp .env.example .env.local` and fill in Supabase URL/keys, `GEMINI_API_KEY`, and a random `N8N_WEBHOOK_SECRET`.
4. **Run**: `npm run dev`

### n8n → `/api/ingest` contract

Each channel trigger (Gmail node, Instagram Graph API webhook, WhatsApp Business webhook) ends in an HTTP Request node:

- `POST {APP_URL}/api/ingest`, header `x-webhook-secret: <N8N_WEBHOOK_SECRET>`
- Body:

```json
{
  "user_id": "<CollabOS user uuid this inbox belongs to>",
  "channel": "gmail",
  "raw_text": "Hi! We'd love to partner on a Reel...",
  "sender": "brand@acme.com",
  "external_thread_id": "gmail-thread-id",
  "external_message_id": "gmail-message-id",
  "received_at": "2026-08-27T09:00:00Z"
}
```

n8n owns the *account → user_id* mapping (a static value per workflow is fine to start; a `channel_accounts` lookup table is the scalable version).

### Testing ingestion without n8n

```bash
curl -X POST http://localhost:3000/api/ingest \
  -H "Content-Type: application/json" \
  -H "x-webhook-secret: $N8N_WEBHOOK_SECRET" \
  -d '{"user_id":"<your-user-uuid>","channel":"gmail","sender":"partnerships@glowco.com","external_thread_id":"t-001","raw_text":"Hi! GlowCo here — we would love a 1x Reel + 3x Stories collab for our fall launch. Budget is $2,500, content due Sep 15."}'
```

## Security model

- Browser and Flutter clients use the **anon key**; RLS restricts every read/write to `auth.uid() = user_id`.
- The **service-role key** lives only in server env and is used by API routes (n8n has no Supabase credentials at all).
- `/api/ingest` authenticates n8n via the `x-webhook-secret` header; `/api/voice-summary` authenticates users via their Supabase JWT.

## Next steps

- Auth UI (Supabase email/OAuth sign-in) — the board and briefing assume a signed-in session.
- `channel_accounts` table mapping connected inboxes → users, replacing the static `user_id` in n8n.
- Outbound replies (write to `messages` with `direction: "outbound"`, send via n8n).
- Flutter client: same Supabase realtime subscription + REST calls against these API routes.
- Swap browser TTS for a hosted voice (e.g. Gemini TTS models) when voice quality matters.
