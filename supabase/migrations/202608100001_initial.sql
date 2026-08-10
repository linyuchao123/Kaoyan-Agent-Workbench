create extension if not exists vector with schema extensions;
create extension if not exists btree_gist with schema extensions;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  target_exam_year integer not null default 2028,
  timezone text not null default 'Asia/Shanghai',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 160),
  subject text not null check (subject in ('math','english','politics','cs408','career')),
  plan_level text not null default 'day' check (plan_level in ('stage','week','day')),
  planned_minutes integer not null default 30 check (planned_minutes between 1 and 1440),
  due_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  parent_id uuid references public.plans(id) on delete cascade,
  level text not null check (level in ('stage','week','day')),
  title text not null check (char_length(title) between 1 and 160),
  description text not null default '',
  starts_on date not null,
  ends_on date not null,
  status text not null default 'active' check (status in ('draft','active','completed','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on >= starts_on)
);

create table public.study_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete set null,
  subject text not null check (subject in ('math','english','politics','cs408','career')),
  started_at timestamptz not null,
  ended_at timestamptz not null,
  paused_seconds integer not null default 0 check (paused_seconds >= 0),
  source text not null default 'timer' check (source in ('timer','manual')),
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ended_at > started_at)
);

alter table public.study_sessions
  add constraint study_sessions_no_user_overlap
  exclude using gist (
    user_id with =,
    tstzrange(started_at, ended_at, '[)') with &&
  );

create index study_sessions_user_started_idx on public.study_sessions(user_id, started_at);
create index tasks_user_due_idx on public.tasks(user_id, due_at);
create index plans_user_dates_idx on public.plans(user_id, starts_on, ends_on);

create table public.knowledge_points (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  parent_id uuid references public.knowledge_points(id) on delete cascade,
  subject text not null check (subject in ('math','english','politics','cs408')),
  title text not null,
  mastery integer not null default 1 check (mastery between 1 and 5),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.question_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  knowledge_point_id uuid references public.knowledge_points(id) on delete set null,
  subject text not null check (subject in ('math','english','politics','cs408')),
  source text,
  question_ref text,
  correct boolean not null,
  duration_seconds integer check (duration_seconds is null or duration_seconds >= 0),
  notes text not null default '',
  attempted_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table public.mistake_cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subject text not null check (subject in ('math','english','politics','cs408')),
  title text not null,
  question text not null,
  answer text not null default '',
  error_reason text not null default '',
  mastery integer not null default 1 check (mastery between 1 and 5),
  next_review_at timestamptz,
  review_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.review_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  mistake_card_id uuid not null references public.mistake_cards(id) on delete cascade,
  result text not null check (result in ('again','hard','good','easy')),
  mastery_before integer not null check (mastery_before between 1 and 5),
  mastery_after integer not null check (mastery_after between 1 and 5),
  reviewed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table public.school_options (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  tier text not null check (tier in ('stretch','match','safety')),
  university text not null,
  college text not null,
  major_code text not null,
  major_name text not null,
  degree_type text not null check (degree_type in ('academic','professional')),
  exam_year integer not null,
  exam_subjects jsonb not null default '[]'::jsonb,
  tuition_total integer,
  duration_years numeric(3,1),
  location text,
  source_url text not null,
  source_checked_at timestamptz not null default now(),
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, college, major_code, exam_year)
);

create table public.career_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  item_type text not null check (item_type in ('milestone','resume','application','interview')),
  title text not null,
  company text,
  status text not null default 'planned',
  occurred_on date,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_type text not null check (source_type in ('upload','web')),
  title text not null,
  original_filename text,
  source_url text,
  storage_path text,
  content_type text not null,
  byte_size bigint,
  sha256 text,
  version integer not null default 1,
  ingestion_status text not null default 'queued' check (ingestion_status in ('queued','processing','ocr_required','ready','failed')),
  ingestion_error text,
  downloaded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index documents_user_hash_idx on public.documents(user_id, sha256) where sha256 is not null;
create unique index documents_user_url_idx on public.documents(user_id, source_url) where source_url is not null;

create table public.document_chunks (
  id bigint generated by default as identity primary key,
  document_id uuid not null references public.documents(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  chunk_index integer not null,
  heading text,
  page_number integer,
  locator text not null,
  content text not null,
  content_tsv tsvector generated always as (to_tsvector('simple', content)) stored,
  embedding extensions.vector(1536),
  created_at timestamptz not null default now(),
  unique(document_id, chunk_index)
);

create index document_chunks_fts_idx on public.document_chunks using gin(content_tsv);
create index document_chunks_embedding_idx on public.document_chunks using hnsw (embedding extensions.vector_cosine_ops);

create table public.import_proposals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_url text not null,
  title text not null,
  summary text not null default '',
  content_type text,
  estimated_bytes bigint,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  decided_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.web_search_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  query text not null,
  provider text not null,
  results jsonb not null default '[]'::jsonb,
  searched_at timestamptz not null default now()
);

create table public.agent_threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  mode text not null check (mode in ('coach','tutor','combined')),
  title text not null default '新对话',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.action_proposals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  thread_id uuid references public.agent_threads(id) on delete set null,
  agent text not null check (agent in ('coach','tutor')),
  action text not null,
  payload jsonb not null,
  summary text not null,
  idempotency_key text not null,
  status text not null default 'pending' check (status in ('pending','approved','edited','rejected','applied','failed')),
  decided_at timestamptz,
  applied_at timestamptz,
  created_at timestamptz not null default now(),
  unique(user_id, idempotency_key)
);

create table public.audit_logs (
  id bigint generated by default as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  proposal_id uuid references public.action_proposals(id) on delete set null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace view public.daily_study_contributions
with (security_invoker = true) as
with session_slices as (
  select
    ss.id,
    ss.user_id,
    ss.subject,
    local_day::date as study_date,
    greatest(
      0,
      extract(epoch from (
        least(ss.ended_at, ((local_day + interval '1 day')::timestamp at time zone p.timezone))
        - greatest(ss.started_at, (local_day::timestamp at time zone p.timezone))
      ))
      - ss.paused_seconds * (
        extract(epoch from (
          least(ss.ended_at, ((local_day + interval '1 day')::timestamp at time zone p.timezone))
          - greatest(ss.started_at, (local_day::timestamp at time zone p.timezone))
        )) / nullif(extract(epoch from (ss.ended_at - ss.started_at)), 0)
      )
    ) as effective_seconds
  from public.study_sessions ss
  join public.profiles p on p.id = ss.user_id
  cross join lateral generate_series(
    date_trunc('day', ss.started_at at time zone p.timezone),
    date_trunc('day', (ss.ended_at - interval '1 microsecond') at time zone p.timezone),
    interval '1 day'
  ) as local_day
), subject_daily as (
  select
    user_id,
    study_date,
    subject,
    floor(sum(effective_seconds) / 60)::integer as effective_minutes,
    count(distinct id)::integer as session_count
  from session_slices
  group by user_id, study_date, subject
), session_daily as (
  select
    user_id,
    study_date,
    sum(effective_minutes)::integer as effective_minutes,
    sum(session_count)::integer as session_count,
    jsonb_object_agg(subject, effective_minutes order by subject) as subject_minutes
  from subject_daily
  group by user_id, study_date
), task_daily as (
  select
    t.user_id,
    (t.completed_at at time zone p.timezone)::date as study_date,
    count(*)::integer as completed_tasks
  from public.tasks t
  join public.profiles p on p.id = t.user_id
  where t.completed_at is not null
  group by t.user_id, (t.completed_at at time zone p.timezone)::date
), mistake_daily as (
  select
    m.user_id,
    (m.created_at at time zone p.timezone)::date as study_date,
    count(*)::integer as mistake_count
  from public.mistake_cards m
  join public.profiles p on p.id = m.user_id
  group by m.user_id, (m.created_at at time zone p.timezone)::date
), activity_days as (
  select user_id, study_date from session_daily
  union
  select user_id, study_date from task_daily
  union
  select user_id, study_date from mistake_daily
)
select
  a.user_id,
  a.study_date,
  coalesce(s.effective_minutes, 0)::integer as effective_minutes,
  coalesce(s.session_count, 0)::integer as session_count,
  coalesce(t.completed_tasks, 0)::integer as completed_tasks,
  coalesce(m.mistake_count, 0)::integer as mistake_count,
  coalesce(s.subject_minutes, '{}'::jsonb) as subject_minutes
from activity_days a
left join session_daily s using (user_id, study_date)
left join task_daily t using (user_id, study_date)
left join mistake_daily m using (user_id, study_date);

create or replace function public.match_document_chunks(
  query_embedding extensions.vector(1536),
  match_count integer default 8,
  filter_document_ids uuid[] default null
)
returns table (
  id bigint,
  document_id uuid,
  title text,
  locator text,
  content text,
  similarity float
)
language sql stable security invoker
as $$
  select
    dc.id,
    dc.document_id,
    d.title,
    dc.locator,
    dc.content,
    1 - (dc.embedding <=> query_embedding) as similarity
  from public.document_chunks dc
  join public.documents d on d.id = dc.document_id
  where dc.user_id = auth.uid()
    and (filter_document_ids is null or dc.document_id = any(filter_document_ids))
    and dc.embedding is not null
  order by dc.embedding <=> query_embedding
  limit least(match_count, 30);
$$;

create or replace function public.hybrid_search_document_chunks(
  query_text text,
  query_embedding extensions.vector(1536),
  match_count integer default 8
)
returns table (
  id bigint,
  document_id uuid,
  title text,
  locator text,
  content text,
  score float
)
language sql stable security invoker
as $$
  select
    dc.id,
    dc.document_id,
    d.title,
    dc.locator,
    dc.content,
    (
      0.65 * (1 - (dc.embedding <=> query_embedding))
      + 0.35 * ts_rank_cd(dc.content_tsv, websearch_to_tsquery('simple', query_text))
    )::float as score
  from public.document_chunks dc
  join public.documents d on d.id = dc.document_id
  where dc.user_id = auth.uid()
    and dc.embedding is not null
  order by score desc
  limit least(match_count, 30);
$$;

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'profiles','plans','tasks','study_sessions','knowledge_points','mistake_cards',
    'school_options','career_items','documents','agent_threads'
  ] loop
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
      table_name || '_set_updated_at', table_name
    );
  end loop;
end $$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.plans enable row level security;
alter table public.tasks enable row level security;
alter table public.study_sessions enable row level security;
alter table public.knowledge_points enable row level security;
alter table public.question_attempts enable row level security;
alter table public.mistake_cards enable row level security;
alter table public.review_events enable row level security;
alter table public.school_options enable row level security;
alter table public.career_items enable row level security;
alter table public.documents enable row level security;
alter table public.document_chunks enable row level security;
alter table public.import_proposals enable row level security;
alter table public.web_search_records enable row level security;
alter table public.agent_threads enable row level security;
alter table public.action_proposals enable row level security;
alter table public.audit_logs enable row level security;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'plans','tasks','study_sessions','knowledge_points','question_attempts',
    'mistake_cards','review_events','school_options','career_items','documents',
    'document_chunks','import_proposals','web_search_records','agent_threads',
    'action_proposals'
  ] loop
    execute format(
      'create policy %I on public.%I for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())',
      table_name || '_owner_policy', table_name
    );
  end loop;
end $$;

drop policy action_proposals_owner_policy on public.action_proposals;
create policy action_proposals_owner_select on public.action_proposals
for select to authenticated using (user_id = auth.uid());

create policy audit_logs_owner_select on public.audit_logs
for select to authenticated using (user_id = auth.uid());

-- profiles use their primary key as the owner key.
create policy profiles_owner_policy on public.profiles
for all to authenticated using (id = auth.uid()) with check (id = auth.uid());

revoke all on function public.match_document_chunks(extensions.vector, integer, uuid[]) from public;
grant execute on function public.match_document_chunks(extensions.vector, integer, uuid[]) to authenticated;
revoke all on function public.hybrid_search_document_chunks(text, extensions.vector, integer) from public;
grant execute on function public.hybrid_search_document_chunks(text, extensions.vector, integer) to authenticated;
