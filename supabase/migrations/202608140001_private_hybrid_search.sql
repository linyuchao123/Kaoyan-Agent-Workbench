-- v0.8: fuse private keyword and vector ranks while preserving user isolation.
create or replace function public.hybrid_search_private_document_chunks(
  query_text text,
  query_embedding extensions.vector(1536),
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
  ),
  eligible as (
    select
      dc.id as chunk_id,
      dc.document_id,
      d.title,
      dc.heading,
      dc.page_number,
      dc.locator,
      dc.content,
      dc.content_tsv,
      dc.embedding
    from public.document_chunks dc
    join public.documents d on d.id = dc.document_id
    where dc.user_id = auth.uid()
      and not dc.flagged_untrusted_instruction
      and (filter_document_ids is null or dc.document_id = any(filter_document_ids))
  ),
  keyword_scored as (
    select
      e.*,
      greatest(
        ts_rank_cd(e.content_tsv, search_query.tsquery),
        case
          when position(lower(search_query.phrase) in lower(e.content)) > 0 then 1.0
          else 0.0
        end
      )::float as keyword_score
    from eligible e
    cross join search_query
    where trim(query_text) <> ''
      and (
        e.content_tsv @@ search_query.tsquery
        or position(lower(search_query.phrase) in lower(e.content)) > 0
      )
  ),
  keyword_candidates as (
    select
      keyword_scored.*,
      row_number() over (order by keyword_score desc, chunk_id asc) as keyword_rank
    from keyword_scored
    order by keyword_score desc, chunk_id asc
    limit least(greatest(match_count * 4, 20), 100)
  ),
  semantic_scored as (
    select
      e.*,
      (1 - (e.embedding <=> query_embedding))::float as semantic_score
    from eligible e
    where e.embedding is not null
  ),
  semantic_candidates as (
    select
      semantic_scored.*,
      row_number() over (order by semantic_score desc, chunk_id asc) as semantic_rank
    from semantic_scored
    order by semantic_score desc, chunk_id asc
    limit least(greatest(match_count * 4, 20), 100)
  ),
  fused as (
    select
      coalesce(k.chunk_id, s.chunk_id) as chunk_id,
      coalesce(k.document_id, s.document_id) as document_id,
      coalesce(k.title, s.title) as title,
      coalesce(k.heading, s.heading) as heading,
      coalesce(k.page_number, s.page_number) as page_number,
      coalesce(k.locator, s.locator) as locator,
      coalesce(k.content, s.content) as content,
      (
        coalesce(0.35 / (60 + k.keyword_rank), 0)
        + coalesce(0.65 / (60 + s.semantic_rank), 0)
      )::float as score
    from keyword_candidates k
    full join semantic_candidates s using (chunk_id)
  )
  select
    fused.chunk_id,
    fused.document_id,
    fused.title,
    fused.heading,
    fused.page_number,
    fused.locator,
    fused.content,
    fused.score
  from fused
  order by fused.score desc, fused.chunk_id asc
  limit least(greatest(match_count, 1), 20);
$$;

revoke all on function public.hybrid_search_private_document_chunks(
  text, extensions.vector, integer, uuid[]
) from public;
grant execute on function public.hybrid_search_private_document_chunks(
  text, extensions.vector, integer, uuid[]
) to authenticated;
