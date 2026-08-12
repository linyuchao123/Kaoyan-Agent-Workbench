-- v0.6: user-scoped private document keyword retrieval.
-- Exact phrase matching supports Chinese text while PostgreSQL FTS covers tokenized queries.
create or replace function public.search_private_document_chunks(
  query_text text,
  match_count integer default 8,
  filter_document_ids uuid[] default null
)
returns table (
  chunk_id bigint,
  document_id uuid,
  title text,
  heading text,
  page_number integer,
  locator text,
  content text,
  score float
)
language sql stable security invoker
set search_path = public, extensions
as $$
  with search_query as (
    select
      trim(query_text) as phrase,
      websearch_to_tsquery('simple', trim(query_text)) as tsquery
  )
  select
    dc.id as chunk_id,
    dc.document_id,
    d.title,
    dc.heading,
    dc.page_number,
    dc.locator,
    dc.content,
    greatest(
      ts_rank_cd(dc.content_tsv, search_query.tsquery),
      case
        when position(lower(search_query.phrase) in lower(dc.content)) > 0 then 1.0
        else 0.0
      end
    )::float as score
  from public.document_chunks dc
  join public.documents d on d.id = dc.document_id
  cross join search_query
  where dc.user_id = auth.uid()
    and trim(query_text) <> ''
    and not dc.flagged_untrusted_instruction
    and (filter_document_ids is null or dc.document_id = any(filter_document_ids))
    and (
      dc.content_tsv @@ search_query.tsquery
      or position(lower(search_query.phrase) in lower(dc.content)) > 0
    )
  order by score desc, dc.id asc
  limit least(greatest(match_count, 1), 20);
$$;

revoke all on function public.search_private_document_chunks(text, integer, uuid[]) from public;
grant execute on function public.search_private_document_chunks(text, integer, uuid[])
to authenticated;
