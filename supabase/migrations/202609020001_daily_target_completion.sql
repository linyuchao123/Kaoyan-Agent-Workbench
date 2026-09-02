-- v1.2: add truthful daily task targets for the default completion heatmap.
-- A task belongs to its day plan date, explicit due date, or creation date (in user timezone).
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
), task_targets as (
  select
    t.user_id,
    t.subject,
    coalesce(
      case when plan.level = 'day' then plan.starts_on end,
      (t.due_at at time zone profile.timezone)::date,
      (t.created_at at time zone profile.timezone)::date
    ) as study_date,
    (t.completed_at is not null) as completed
  from public.tasks t
  join public.profiles profile on profile.id = t.user_id
  left join public.plans plan on plan.id = t.plan_id and plan.user_id = t.user_id
), task_target_subject_daily as (
  select
    user_id,
    study_date,
    subject,
    count(*)::integer as target_tasks,
    count(*) filter (where completed)::integer as completed_target_tasks
  from task_targets
  group by user_id, study_date, subject
), task_target_daily as (
  select
    user_id,
    study_date,
    sum(target_tasks)::integer as target_tasks,
    sum(completed_target_tasks)::integer as completed_target_tasks,
    jsonb_object_agg(subject, target_tasks order by subject) as subject_target_tasks,
    jsonb_object_agg(subject, completed_target_tasks order by subject) as subject_completed_target_tasks
  from task_target_subject_daily
  group by user_id, study_date
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
  select user_id, study_date from task_target_daily
  union
  select user_id, study_date from mistake_daily
)
select
  activity.user_id,
  activity.study_date,
  coalesce(session.effective_minutes, 0)::integer as effective_minutes,
  coalesce(session.session_count, 0)::integer as session_count,
  coalesce(task.completed_tasks, 0)::integer as completed_tasks,
  coalesce(target.target_tasks, 0)::integer as target_tasks,
  coalesce(target.completed_target_tasks, 0)::integer as completed_target_tasks,
  coalesce(mistake.mistake_count, 0)::integer as mistake_count,
  coalesce(session.subject_minutes, '{}'::jsonb) as subject_minutes,
  coalesce(target.subject_target_tasks, '{}'::jsonb) as subject_target_tasks,
  coalesce(target.subject_completed_target_tasks, '{}'::jsonb) as subject_completed_target_tasks
from activity_days activity
left join session_daily session using (user_id, study_date)
left join task_daily task using (user_id, study_date)
left join task_target_daily target using (user_id, study_date)
left join mistake_daily mistake using (user_id, study_date);

grant select on public.daily_study_contributions to authenticated;
