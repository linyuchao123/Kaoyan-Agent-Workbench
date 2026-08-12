-- v0.5: allow authenticated users to manage their own school intelligence records.
-- Row-level security remains the ownership boundary.
grant select, insert, update, delete
on public.school_options
to authenticated;
