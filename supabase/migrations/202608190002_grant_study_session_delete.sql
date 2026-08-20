-- v1.0: authenticated users may delete only their own study sessions.
-- Existing row-level security remains the ownership boundary.
grant delete on public.study_sessions to authenticated;
