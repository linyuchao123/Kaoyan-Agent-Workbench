-- v1.3: atomically approve a bounded multi-task daily-plan proposal.

create or replace function public.decide_agent_proposal(
  requested_proposal_id uuid,
  requested_decision text,
  edited_payload jsonb default null
)
returns public.action_proposals
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_id uuid := auth.uid();
  current_proposal public.action_proposals;
  task_item jsonb;
  task_title text;
  task_subject text;
  task_minutes integer;
  task_count integer := 0;
  total_minutes integer := 0;
begin
  if owner_id is null then
    raise exception 'authentication required';
  end if;
  if requested_decision not in ('approve', 'edit', 'reject') then
    raise exception 'unknown proposal decision';
  end if;

  select * into current_proposal
  from public.action_proposals
  where id = requested_proposal_id and user_id = owner_id
  for update;
  if current_proposal.id is null then
    return null;
  end if;

  if requested_decision = 'approve' and current_proposal.status = 'applied' then
    insert into public.audit_logs (user_id, proposal_id, event_type, payload)
    values (owner_id, current_proposal.id, 'proposal_approval_replayed', '{}'::jsonb);
    return current_proposal;
  end if;
  if current_proposal.status not in ('pending', 'edited') then
    return current_proposal;
  end if;

  if requested_decision = 'edit' then
    update public.action_proposals
    set payload = coalesce(edited_payload, payload), status = 'edited', decided_at = now()
    where id = current_proposal.id
    returning * into current_proposal;
  elsif requested_decision = 'reject' then
    update public.action_proposals
    set status = 'rejected', decided_at = now()
    where id = current_proposal.id
    returning * into current_proposal;
  else
    if current_proposal.action = 'create_review_task' then
      task_title := coalesce(nullif(current_proposal.payload ->> 'title', ''), 'Agent 复习任务');
      task_subject := coalesce(nullif(current_proposal.payload ->> 'subject', ''), 'cs408');
      task_minutes := coalesce((current_proposal.payload ->> 'planned_minutes')::integer, 45);
      if task_subject not in ('math', 'english', 'politics', 'cs408', 'career') then
        raise exception 'invalid task subject';
      end if;
      if task_minutes not between 1 and 1440 then
        raise exception 'invalid planned minutes';
      end if;
      insert into public.tasks (user_id, title, subject, planned_minutes)
      values (owner_id, left(task_title, 160), task_subject, task_minutes);
      task_count := 1;
      total_minutes := task_minutes;
    elsif current_proposal.action = 'create_daily_tasks' then
      if jsonb_typeof(current_proposal.payload -> 'tasks') <> 'array' then
        raise exception 'daily plan tasks are required';
      end if;
      task_count := jsonb_array_length(current_proposal.payload -> 'tasks');
      if task_count not between 1 and 4 then
        raise exception 'daily plan must contain 1 to 4 tasks';
      end if;
      for task_item in select value from jsonb_array_elements(current_proposal.payload -> 'tasks')
      loop
        task_title := nullif(btrim(task_item ->> 'title'), '');
        task_subject := task_item ->> 'subject';
        task_minutes := (task_item ->> 'planned_minutes')::integer;
        if task_title is null or char_length(task_title) > 160 then
          raise exception 'invalid task title';
        end if;
        if task_subject not in ('math', 'english', 'politics', 'cs408', 'career') then
          raise exception 'invalid task subject';
        end if;
        if task_minutes not between 1 and 120 then
          raise exception 'daily plan task cannot exceed 120 minutes';
        end if;
        total_minutes := total_minutes + task_minutes;
      end loop;
      if total_minutes > 240 then
        raise exception 'daily plan cannot exceed 240 minutes';
      end if;
      for task_item in select value from jsonb_array_elements(current_proposal.payload -> 'tasks')
      loop
        insert into public.tasks (user_id, title, subject, planned_minutes)
        values (
          owner_id,
          btrim(task_item ->> 'title'),
          task_item ->> 'subject',
          (task_item ->> 'planned_minutes')::integer
        );
      end loop;
    else
      raise exception 'unsupported proposal action';
    end if;

    update public.action_proposals
    set status = 'applied', decided_at = now(), applied_at = now()
    where id = current_proposal.id
    returning * into current_proposal;
  end if;

  insert into public.audit_logs (user_id, proposal_id, event_type, payload)
  values (owner_id, current_proposal.id, 'proposal_' || requested_decision, jsonb_build_object(
    'status', current_proposal.status,
    'action', current_proposal.action,
    'task_count', task_count,
    'total_minutes', total_minutes
  ));
  return current_proposal;
end;
$$;

revoke all on function public.decide_agent_proposal(uuid, text, jsonb) from public;
grant execute on function public.decide_agent_proposal(uuid, text, jsonb) to authenticated;
