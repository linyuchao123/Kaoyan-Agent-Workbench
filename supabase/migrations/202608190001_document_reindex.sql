-- v0.9: rebuild a document index atomically and keep its chunking provenance.
alter table public.documents
  add column if not exists chunking_version integer not null default 1,
  add column if not exists indexed_at timestamptz;

update public.documents
set indexed_at = coalesce(indexed_at, updated_at, created_at)
where ingestion_status = 'ready' and indexed_at is null;

create or replace function public.replace_document_chunks(
  requested_document_id uuid,
  replacement_chunks jsonb,
  requested_chunking_version integer,
  requested_embedding_provider text default null,
  requested_embedding_model text default null,
  requested_embedding_dimensions integer default null,
  requested_embedding_version text default null
)
returns setof public.documents
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  owner_id uuid := auth.uid();
  current_document public.documents;
begin
  if owner_id is null then
    raise exception 'authentication required';
  end if;
  if requested_chunking_version < 1 then
    raise exception 'invalid chunking version';
  end if;

  select * into current_document
  from public.documents
  where id = requested_document_id and user_id = owner_id
  for update;

  if current_document.id is null then
    raise exception 'document not found';
  end if;

  delete from public.document_chunks
  where document_id = requested_document_id and user_id = owner_id;

  insert into public.document_chunks (
    document_id,
    user_id,
    chunk_index,
    heading,
    page_number,
    locator,
    content,
    flagged_untrusted_instruction,
    embedding
  )
  select
    requested_document_id,
    owner_id,
    (item ->> 'chunk_index')::integer,
    nullif(item ->> 'heading', ''),
    nullif(item ->> 'page_number', '')::integer,
    item ->> 'locator',
    item ->> 'content',
    coalesce((item ->> 'flagged_untrusted_instruction')::boolean, false),
    case
      when item -> 'embedding' is null or item -> 'embedding' = 'null'::jsonb then null
      else (item ->> 'embedding')::extensions.vector(1536)
    end
  from jsonb_array_elements(replacement_chunks) item;

  update public.documents
  set
    ingestion_status = 'ready',
    ingestion_error = null,
    version = version + 1,
    chunking_version = requested_chunking_version,
    indexed_at = now(),
    embedding_provider = requested_embedding_provider,
    embedding_model = requested_embedding_model,
    embedding_dimensions = requested_embedding_dimensions,
    embedding_version = requested_embedding_version,
    updated_at = now()
  where id = requested_document_id and user_id = owner_id;

  return query
  select * from public.documents
  where id = requested_document_id and user_id = owner_id;
end;
$$;

create or replace function public.enqueue_document_reindex_ocr(
  requested_document_id uuid,
  requested_chunking_version integer
)
returns public.ocr_jobs
language plpgsql security definer
set search_path = public
as $$
declare
  owner_id uuid := auth.uid();
  queued_job public.ocr_jobs;
begin
  if owner_id is null then
    raise exception 'authentication required';
  end if;

  update public.documents
  set
    ingestion_status = 'ocr_required',
    ingestion_error = null,
    chunking_version = requested_chunking_version,
    indexed_at = null,
    updated_at = now()
  where id = requested_document_id and user_id = owner_id;

  if not found then
    raise exception 'document not found';
  end if;

  select * into queued_job
  from public.enqueue_document_ocr(requested_document_id);
  return queued_job;
end;
$$;

create or replace function public.stamp_completed_document_index()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.ingestion_status = 'ready' and old.ingestion_status <> 'ready' then
    new.indexed_at := now();
    new.version := old.version + 1;
  end if;
  return new;
end;
$$;

drop trigger if exists documents_stamp_completed_index on public.documents;
create trigger documents_stamp_completed_index
before update of ingestion_status on public.documents
for each row execute function public.stamp_completed_document_index();

revoke all on function public.replace_document_chunks(
  uuid, jsonb, integer, text, text, integer, text
) from public;
grant execute on function public.replace_document_chunks(
  uuid, jsonb, integer, text, text, integer, text
) to authenticated;
revoke all on function public.enqueue_document_reindex_ocr(uuid, integer) from public;
grant execute on function public.enqueue_document_reindex_ocr(uuid, integer) to authenticated;
