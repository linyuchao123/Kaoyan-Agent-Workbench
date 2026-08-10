-- v0.3: make the contribution view complete for cloud-backed API responses.
create index if not exists tasks_user_completed_idx
  on public.tasks(user_id, completed_at)
  where completed_at is not null;

drop view if exists public.daily_study_contributions;

create view public.daily_study_contributions
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

grant select, insert, update on public.tasks to authenticated;
grant select, insert on public.study_sessions to authenticated;
grant select on public.profiles to authenticated;
grant select on public.mistake_cards to authenticated;
grant select on public.daily_study_contributions to authenticated;
