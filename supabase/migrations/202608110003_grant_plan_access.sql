-- v0.4: allow authenticated users to operate on their own plans through RLS.
grant select, insert, update, delete on public.plans to authenticated;
