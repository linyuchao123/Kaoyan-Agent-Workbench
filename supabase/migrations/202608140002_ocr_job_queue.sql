-- v0.8: durable OCR queue with owner reads and service-role worker operations.
create table if not exists public.ocr_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'completed', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 3 check (max_attempts between 1 and 10),
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  completed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (document_id)
);

create index if not exists ocr_jobs_claim_idx
on public.ocr_jobs(status, available_at, created_at)
where status = 'queued';

alter table public.ocr_jobs enable row level security;

create policy ocr_jobs_owner_select
on public.ocr_jobs for select to authenticated
using (user_id = auth.uid());

grant select on public.ocr_jobs to authenticated;

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
  if current_document.ingestion_status not in ('ocr_required', 'failed') then
    raise exception 'document does not require OCR';
  end if;

  insert into public.ocr_jobs (user_id, document_id)
  values (owner_id, requested_document_id)
  on conflict (document_id) do update set
    status = 'queued',
    attempts = case when ocr_jobs.status = 'failed' then 0 else ocr_jobs.attempts end,
    available_at = now(),
    locked_at = null,
    completed_at = null,
    last_error = null,
    updated_at = now()
  where ocr_jobs.user_id = owner_id
  returning * into queued_job;

  return queued_job;
end;
$$;

create or replace function public.claim_document_ocr()
returns public.ocr_jobs
language plpgsql security definer
set search_path = public
as $$
declare
  claimed_job public.ocr_jobs;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role required';
  end if;

  update public.ocr_jobs
  set
    status = 'processing',
    attempts = attempts + 1,
    locked_at = now(),
    updated_at = now()
  where id = (
    select id
    from public.ocr_jobs
    where status = 'queued' and available_at <= now()
    order by available_at asc, created_at asc
    for update skip locked
    limit 1
  )
  returning * into claimed_job;

  return claimed_job;
end;
$$;

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

  update public.documents
  set ingestion_status = 'ready', ingestion_error = null, updated_at = now()
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

create or replace function public.fail_document_ocr(
  requested_job_id uuid,
  failure_message text
)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  current_job public.ocr_jobs;
  should_retry boolean;
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

  should_retry := current_job.attempts < current_job.max_attempts;
  update public.ocr_jobs
  set
    status = case when should_retry then 'queued' else 'failed' end,
    available_at = case
      when should_retry then now() + make_interval(
        mins => least(30, power(2, greatest(current_job.attempts - 1, 0))::integer)
      )
      else available_at
    end,
    locked_at = null,
    last_error = left(failure_message, 1000),
    updated_at = now()
  where id = current_job.id;

  update public.documents
  set
    ingestion_status = case when should_retry then 'ocr_required' else 'failed' end,
    ingestion_error = left(failure_message, 1000),
    updated_at = now()
  where id = current_job.document_id and user_id = current_job.user_id;
end;
$$;

revoke all on function public.enqueue_document_ocr(uuid) from public;
grant execute on function public.enqueue_document_ocr(uuid) to authenticated;
revoke all on function public.claim_document_ocr() from public;
grant execute on function public.claim_document_ocr() to service_role;
revoke all on function public.complete_document_ocr(uuid, jsonb) from public;
grant execute on function public.complete_document_ocr(uuid, jsonb) to service_role;
revoke all on function public.fail_document_ocr(uuid, text) from public;
grant execute on function public.fail_document_ocr(uuid, text) to service_role;
