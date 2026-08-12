-- v0.5: allow authenticated users to manage their own career records.
-- Career records are isolated by the existing user ownership RLS policy.
grant select, insert, update, delete
on public.career_items
to authenticated;
