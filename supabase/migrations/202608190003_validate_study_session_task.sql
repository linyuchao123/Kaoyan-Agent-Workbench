-- v1.0: a study session may reference only an owned task with the same subject.
-- This trigger protects direct Data API writes in addition to FastAPI validation.
create or replace function public.validate_study_session_task()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.task_id is not null and not exists (
    select 1
    from public.tasks t
    where t.id = new.task_id
      and t.user_id = new.user_id
      and t.subject = new.subject
  ) then
    raise exception 'study session task must be owned by the same user and use the same subject';
  end if;
  return new;
end;
$$;

drop trigger if exists study_sessions_validate_task on public.study_sessions;
create trigger study_sessions_validate_task
before insert or update of task_id, user_id, subject on public.study_sessions
for each row execute function public.validate_study_session_task();
