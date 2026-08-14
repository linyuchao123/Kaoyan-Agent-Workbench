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

revoke all on function public.enqueue_document_ocr(uuid) from public;
grant execute on function public.enqueue_document_ocr(uuid) to authenticated;
revoke all on function public.claim_document_ocr() from public;
grant execute on function public.claim_document_ocr() to service_role;
