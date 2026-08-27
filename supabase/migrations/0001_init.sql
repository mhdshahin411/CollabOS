-- ============================================================
-- CollabOS — initial schema
-- deals: AI-extracted structured deals (the Kanban cards)
-- messages: raw message threads behind each deal
-- ============================================================

create extension if not exists "pgcrypto";

-- ---------- Enums ----------
create type public.deal_stage as enum ('new_pitch', 'negotiating', 'drafting', 'completed');
create type public.deal_priority as enum ('low', 'medium', 'high');
create type public.channel_type as enum ('gmail', 'instagram', 'whatsapp');

-- ---------- deals ----------
create table public.deals (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users (id) on delete cascade,
  brand_name          text not null,
  contact_name        text,
  budget              numeric(12, 2),
  currency            text default 'USD',
  deliverables        jsonb not null default '[]'::jsonb,   -- e.g. ["1x Reel", "3x Stories"]
  deadline            date,
  priority            public.deal_priority not null default 'medium',
  stage               public.deal_stage not null default 'new_pitch',
  summary             text,                                 -- AI-generated one-liner
  source_channel      public.channel_type not null,
  external_thread_id  text,                                 -- Gmail thread ID / IG conversation ID / WA chat ID
  is_read             boolean not null default false,       -- drives the voice briefing "unread" queue
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- ---------- messages (raw thread history) ----------
create table public.messages (
  id                   uuid primary key default gen_random_uuid(),
  deal_id              uuid not null references public.deals (id) on delete cascade,
  user_id              uuid not null references auth.users (id) on delete cascade,
  channel              public.channel_type not null,
  direction            text not null default 'inbound' check (direction in ('inbound', 'outbound')),
  sender               text,
  raw_text             text not null,
  external_message_id  text,
  external_thread_id   text,
  received_at          timestamptz not null default now(),
  created_at           timestamptz not null default now()
);

-- ---------- Indexes ----------
create index deals_user_stage_idx   on public.deals (user_id, stage);
create index deals_user_unread_idx  on public.deals (user_id) where not is_read;
-- One deal per (user, channel, thread): lets the ingest route route follow-up
-- messages to the existing deal instead of creating duplicates.
create unique index deals_user_thread_uidx
  on public.deals (user_id, source_channel, external_thread_id)
  where external_thread_id is not null;

create index messages_deal_idx    on public.messages (deal_id, received_at);
create index messages_thread_idx  on public.messages (external_thread_id);
-- Idempotency for n8n retries: the same provider message can only be stored once.
-- NON-partial on purpose — Postgres treats NULLs as distinct, so messages with no
-- external_message_id still insert freely, and a bare column list (all PostgREST
-- can emit for on_conflict) can only infer a non-partial index.
create unique index messages_external_id_uidx
  on public.messages (user_id, channel, external_message_id);

-- ---------- updated_at trigger ----------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger deals_set_updated_at
  before update on public.deals
  for each row execute function public.set_updated_at();

-- ---------- Row Level Security ----------
-- Browser/Flutter clients use the anon key + the user's JWT, so RLS is the
-- security boundary. The ingest API uses the service-role key (bypasses RLS).
alter table public.deals enable row level security;
alter table public.messages enable row level security;

create policy "Users can view their own deals"
  on public.deals for select
  using (auth.uid() = user_id);

create policy "Users can insert their own deals"
  on public.deals for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own deals"
  on public.deals for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete their own deals"
  on public.deals for delete
  using (auth.uid() = user_id);

create policy "Users can view their own messages"
  on public.messages for select
  using (auth.uid() = user_id);

create policy "Users can insert their own messages"
  on public.messages for insert
  with check (auth.uid() = user_id);

-- ---------- Realtime ----------
-- Broadcast row changes so the Next.js/Flutter Kanban updates instantly.
alter publication supabase_realtime add table public.deals;
alter publication supabase_realtime add table public.messages;
-- Include full old-row data in UPDATE/DELETE events.
alter table public.deals replica identity full;
