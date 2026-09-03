-- v1.3: allow authenticated owners to complete mistake-card CRUD through RLS.
grant select, insert, update, delete on public.mistake_cards to authenticated;
