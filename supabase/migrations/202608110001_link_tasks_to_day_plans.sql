-- v0.4: allow a task to belong to one day plan owned by the same user.
alter table public.tasks
  add column if not exists plan_id uuid references public.plans(id) on delete set null;

create index if not exists tasks_user_plan_idx
  on public.tasks(user_id, plan_id)
  where plan_id is not null;

create or replace function public.validate_task_day_plan()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.plan_id is not null and not exists (
    select 1
    from public.plans p
    where p.id = new.plan_id
      and p.user_id = new.user_id
      and p.level = 'day'
  ) then
    raise exception 'task plan must be an owned day plan' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_validate_day_plan on public.tasks;
create trigger tasks_validate_day_plan
before insert or update of plan_id, user_id on public.tasks
for each row execute function public.validate_task_day_plan();
