-- v0.8: keep every document's vector provenance explicit and dimension-safe.
alter table public.documents
  add column if not exists embedding_provider text,
  add column if not exists embedding_model text,
  add column if not exists embedding_dimensions integer,
  add column if not exists embedding_version text;

alter table public.documents
  drop constraint if exists documents_embedding_dimensions_check;

alter table public.documents
  add constraint documents_embedding_dimensions_check
  check (embedding_dimensions is null or embedding_dimensions = 1536);

create or replace function public.complete_document_ocr(
  requested_job_id uuid,
  extracted_chunks jsonb
)
returns void
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  current_job public.ocr_jobs;
  metadata jsonb;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role required';
  end if;

  select * into current_job
  from public.ocr_jobs
  where id = requested_job_id
  for update;

  if current_job.id is null or current_job.status <> 'processing' then
    raise exception 'processing OCR job not found';
  end if;

  delete from public.document_chunks
  where document_id = current_job.document_id and user_id = current_job.user_id;

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
    current_job.document_id,
    current_job.user_id,
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
  from jsonb_array_elements(extracted_chunks) item;

  metadata := extracted_chunks -> 0;
  update public.documents
  set
    ingestion_status = 'ready',
    ingestion_error = null,
    embedding_provider = nullif(metadata ->> 'embedding_provider', ''),
    embedding_model = nullif(metadata ->> 'embedding_model', ''),
    embedding_dimensions = nullif(metadata ->> 'embedding_dimensions', '')::integer,
    embedding_version = nullif(metadata ->> 'embedding_version', ''),
    updated_at = now()
  where id = current_job.document_id and user_id = current_job.user_id;

  update public.ocr_jobs
  set
    status = 'completed',
    completed_at = now(),
    locked_at = null,
    last_error = null,
    updated_at = now()
  where id = current_job.id;
end;
$$;

revoke all on function public.complete_document_ocr(uuid, jsonb) from public;
grant execute on function public.complete_document_ocr(uuid, jsonb) to service_role;
