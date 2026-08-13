-- v0.7: persist a user's web search trace without making it part of private RAG.
-- Existing owner RLS policies continue to isolate every record by auth.uid().
grant select, insert
on public.web_search_records
to authenticated;
