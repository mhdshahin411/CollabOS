# CollabOS

AI-powered CRM and unified dashboard for social media influencers. Brand pitches from Gmail, Instagram, and WhatsApp flow into one real-time Kanban pipeline, with an AI voice assistant on top.

## Architecture

```
Gmail ─┐
IG DM ─┼─▶ n8n ─▶ POST /api/ingest ─▶ OpenAI gpt-4o-mini ─▶ Supabase (deals + messages)
WA    ─┘        (x-webhook-secret)    (JSON extraction)          │
                                                                 ▼ realtime
                                                Next.js dashboard / Flutter app
                                                  │                         │
            Mic (STT) ─▶ POST /api/voice-summary ◀┘                         ▼
                           (deals + OpenAI) ─▶ TTS playback        POST /api/reply
                                                                            │
                                               Gmail reply ◀── n8n outbound webhook
```

- **Ingestion** — n8n listens on each channel and forwards raw messages to `/api/ingest` with a shared-secret header. Payloads a retry can't fix (malformed fields, unknown user) get a 4xx so n8n stops retrying; transient failures get a 5xx.
- **AI extraction** — OpenAI (`gpt-4o-mini`, structured JSON output) pulls out brand, budget, currency, deliverables, deadline, priority, and a CRM summary. Values the database would reject (e.g. a deadline of "TBD") become null. Non-deal messages (spam, fan mail) are skipped.
- **Threading** — messages carrying a known `external_thread_id` attach to their existing deal (and mark it unread) instead of creating a duplicate, and the deal's summary is updated with the new message in context.
- **Real-time UI** — the Kanban board and the open conversation subscribe to Supabase `postgres_changes`, so new deals and messages appear instantly. Drag-and-drop stage moves are optimistic with rollback (the conversation panel also has a stage picker for keyboard and touch). Opening a deal marks it read.
- **Voice assistant** — the Briefing button greets you and summarizes unread pitches; the mic (Web Speech API) answers spoken questions about your deals. `/api/voice-summary` writes the answer with OpenAI and the browser reads it aloud via `speechSynthesis`.
- **Outbound replies** — replying on a Gmail deal posts to `/api/reply`, which records the reply and forwards it to an n8n webhook that sends it as a real Gmail reply. Every reply is stored with a delivery status (sent, failed, unconfirmed, or saved as a note), shown under it in the thread. Instagram and WhatsApp replies are saved as notes for now.

## Project structure

```
supabase/migrations/
  0001_init.sql                          # deals + messages, RLS, realtime publication
  0002_reply_status_and_message_rls.sql  # reply delivery status, stricter message RLS
src/
  app/
    page.tsx                        # AuthGate: login form or the dashboard
    api/ingest/route.ts             # n8n webhook -> OpenAI extraction -> Supabase
    api/reply/route.ts              # outbound reply -> n8n outbound webhook (Gmail)
    api/voice-summary/route.ts      # deals + recent activity -> OpenAI briefing/answer
  components/
    AuthGate.tsx, LoginForm.tsx     # Supabase email/password session gate
    DashboardShell.tsx              # layout: sidebar, briefing, analytics, board, overlays
    KanbanBoard.tsx, DealCard.tsx   # 4-stage drag-and-drop pipeline
    ConversationPanel.tsx           # deal details, live thread, reply composer
    Sidebar.tsx, SettingsModal.tsx  # pipeline value, channel filters, account labels
    Analytics.tsx, DailySummary.tsx # charts and the daily briefing card
    VoiceAssistant.tsx              # Briefing button + mic (STT -> API -> TTS)
  lib/
    ai.ts                           # OpenAI client, extraction schema, briefing prompt
    dealsStore.tsx                  # deals context: load + realtime, move, mark read
    money.ts                        # per-currency formatting and totals
    supabase/client.ts              # browser client (anon key, RLS enforced)
    supabase/admin.ts               # server-only service-role client
    types.ts                        # Deal / Message / stage definitions
```

## Setup

1. **Install deps**: `npm install`
2. **Supabase**: create a project, then run the files in `supabase/migrations/` in order in the SQL editor (or `supabase db push` with the CLI). Enable the email auth provider and create your user. For a single-user deployment, also turn off "Allow new users to sign up" in the Authentication settings — otherwise anyone can create an account with the public anon key and spend your OpenAI credits through the API routes (RLS still keeps your data private).
3. **Env**: `cp .env.example .env.local` and fill in the Supabase URL/keys, `OPENAI_API_KEY`, a random `N8N_WEBHOOK_SECRET`, and `N8N_OUTBOUND_WEBHOOK_URL` if Gmail replies should actually send.
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

`user_id`, `channel` and `raw_text` are required; blank optional fields count as absent. Always send `external_message_id` when the channel has one — it's what makes n8n retries safe.

n8n owns the *account → user_id* mapping (a static value per workflow is fine to start; a `channel_accounts` lookup table is the scalable version).

### `/api/reply` → n8n outbound contract

For Gmail deals, `/api/reply` calls `POST {N8N_OUTBOUND_WEBHOOK_URL}` with header `x-webhook-secret: <N8N_WEBHOOK_SECRET>` and body:

```json
{
  "channel": "gmail",
  "message_id": "<Gmail message id of the latest inbound email on the thread>",
  "text": "<reply body>",
  "deal_id": "<uuid>"
}
```

The workflow should reply to `message_id` from the connected Gmail account, and only answer 2xx once the email is sent (respond after the Gmail node, not immediately) — the app marks the reply **sent** on any 2xx, **failed** on any other status or if n8n can't be reached, and **unconfirmed** if n8n doesn't answer within 15 seconds.

### Testing ingestion without n8n

```bash
curl -X POST http://localhost:3000/api/ingest \
  -H "Content-Type: application/json" \
  -H "x-webhook-secret: $N8N_WEBHOOK_SECRET" \
  -d '{"user_id":"<your-user-uuid>","channel":"gmail","sender":"partnerships@glowco.com","external_thread_id":"t-001","raw_text":"Hi! GlowCo here — we would love a 1x Reel + 3x Stories collab for our fall launch. Budget is $2,500, content due Sep 15."}'
```

## Security model

- Browser and Flutter clients use the **anon key**; RLS restricts every read/write to `auth.uid() = user_id`, and messages can only be attached to the caller's own deals.
- The **service-role key** lives only in server env and is used by API routes (n8n has no Supabase credentials at all).
- `/api/ingest` authenticates n8n via the `x-webhook-secret` header; `/api/reply` and `/api/voice-summary` authenticate users via their Supabase JWT.
- Turn off public sign-ups for a single-user deployment (see Setup).

## Next steps

- `channel_accounts` table mapping connected inboxes → users, replacing the static `user_id` in n8n.
- Sending replies on Instagram and WhatsApp (they're saved as notes today).
- Flutter client: same Supabase realtime subscriptions + REST calls against these API routes.
- Swap browser TTS for a hosted voice when voice quality matters.
