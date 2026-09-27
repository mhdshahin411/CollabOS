-- ============================================================
-- CollabOS — 0002: reply delivery status + message ownership
-- ============================================================

-- Outbound replies record whether they actually reached the brand, so a failed
-- or unconfirmed send never looks like a delivered one. NULL for inbound rows
-- (and for replies recorded before this migration).
--   unconfirmed  recorded; the send is in flight, or its outcome is unknown
--   sent         the send service accepted it
--   failed       the send service rejected it or couldn't be reached
--   not_sent     saved as a note — this channel/thread can't send yet
alter table public.messages
  add column delivery_status text
    check (delivery_status in ('unconfirmed', 'sent', 'failed', 'not_sent'));

-- A message may only be attached to one of the caller's own deals. The FK
-- check on deal_id bypasses RLS, so the original policy let a user attach
-- rows to another user's deal.
drop policy if exists "Users can insert their own messages" on public.messages;

create policy "Users can insert messages on their own deals"
  on public.messages for insert
  with check (
    auth.uid() = user_id
    and exists (select 1 from public.deals d where d.id = deal_id and d.user_id = auth.uid())
  );
