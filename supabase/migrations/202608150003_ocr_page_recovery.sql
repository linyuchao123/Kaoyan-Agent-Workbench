-- v0.8: preserve partial OCR success, record page-level recovery and allow retry.
alter table public.documents
  add column if not exists ocr_failed_pages integer[] not null default '{}',
  add column if not exists ocr_fallback_pages integer[] not null default '{}';

create or replace function public.enqueue_document_ocr(requested_document_id uuid)
returns public.ocr_jobs
language plpgsql security definer
set search_path = public
as $$
declare
  owner_id uuid := auth.uid();
  current_document public.documents;
  queued_job public.ocr_jobs;
begin
  if owner_id is null then
    raise exception 'authentication required';
  end if;

  select * into current_document
  from public.documents
  where id = requested_document_id and user_id = owner_id;

  if current_document.id is null then
    raise exception 'document not found';
  end if;
  if current_document.ingestion_status not in ('ocr_required', 'failed')
    and cardinality(current_document.ocr_failed_pages) = 0 then
    raise exception 'document does not require OCR';
  end if;

  insert into public.ocr_jobs (user_id, document_id)
  values (owner_id, requested_document_id)
  on conflict (document_id) do update set
    status = 'queued',
    attempts = 0,
    available_at = now(),
    locked_at = null,
    completed_at = null,
    last_error = null,
    updated_at = now()
  where ocr_jobs.user_id = owner_id
    and ocr_jobs.status in ('failed', 'completed')
  returning * into queued_job;

  if queued_job.id is null then
    select * into queued_job
    from public.ocr_jobs
    where document_id = requested_document_id and user_id = owner_id;
  end if;

  update public.documents
  set ingestion_status = 'ocr_required', ingestion_error = null, updated_at = now()
  where id = requested_document_id and user_id = owner_id;

  return queued_job;
end;
$$;

drop function if exists public.complete_document_ocr(uuid, jsonb);

create function public.complete_document_ocr(
  requested_job_id uuid,
  extracted_chunks jsonb,
  ocr_metadata jsonb
)
returns void
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  current_job public.ocr_jobs;
  failed_pages integer[];
  fallback_pages integer[];
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

  select coalesce(array_agg(value::integer), '{}') into failed_pages
  from jsonb_array_elements_text(coalesce(ocr_metadata -> 'failed_pages', '[]'::jsonb));
  select coalesce(array_agg(value::integer), '{}') into fallback_pages
  from jsonb_array_elements_text(coalesce(ocr_metadata -> 'fallback_pages', '[]'::jsonb));

  delete from public.document_chunks
  where document_id = current_job.document_id and user_id = current_job.user_id;

  insert into public.document_chunks (
    document_id, user_id, chunk_index, heading, page_number, locator, content,
    flagged_untrusted_instruction, embedding
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

  update public.documents
  set
    ingestion_status = 'ready',
    ingestion_error = case
      when cardinality(failed_pages) > 0
      then format('OCR 部分页面失败：%s', array_to_string(failed_pages, ', '))
      else null
    end,
    embedding_provider = nullif(ocr_metadata ->> 'embedding_provider', ''),
    embedding_model = nullif(ocr_metadata ->> 'embedding_model', ''),
    embedding_dimensions = nullif(ocr_metadata ->> 'embedding_dimensions', '')::integer,
    embedding_version = nullif(ocr_metadata ->> 'embedding_version', ''),
    ocr_failed_pages = failed_pages,
    ocr_fallback_pages = fallback_pages,
    updated_at = now()
  where id = current_job.document_id and user_id = current_job.user_id;

  update public.ocr_jobs
  set status = 'completed', completed_at = now(), locked_at = null,
      last_error = null, updated_at = now()
  where id = current_job.id;
end;
$$;

revoke all on function public.enqueue_document_ocr(uuid) from public;
grant execute on function public.enqueue_document_ocr(uuid) to authenticated;
revoke all on function public.complete_document_ocr(uuid, jsonb, jsonb) from public;
grant execute on function public.complete_document_ocr(uuid, jsonb, jsonb) to service_role;
