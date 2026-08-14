-- v0.7: persist Agent threads, proposals, decisions and audit events.
-- Business writes stay behind security-definer RPCs so clients cannot forge approval state.

create or replace function public.create_agent_proposal(
  requested_thread_id uuid,
  requested_mode text,
  requested_agent text,
  requested_action text,
  requested_payload jsonb,
  requested_summary text,
  requested_idempotency_key text
)
returns table(thread_id uuid, proposal jsonb)
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_id uuid := auth.uid();
  current_thread_id uuid;
  current_proposal public.action_proposals;
begin
  if owner_id is null then
    raise exception 'authentication required';
  end if;
  if requested_mode not in ('coach', 'tutor', 'combined') then
    raise exception 'unknown agent mode';
  end if;
  if requested_agent not in ('coach', 'tutor') then
    raise exception 'unknown proposal agent';
  end if;

  if requested_thread_id is null then
    insert into public.agent_threads (user_id, mode, title)
    values (owner_id, requested_mode, left(requested_summary, 120))
    returning id into current_thread_id;
  else
    select id into current_thread_id
    from public.agent_threads
    where id = requested_thread_id and user_id = owner_id;
    if current_thread_id is null then
      raise exception 'agent thread not found';
    end if;
    update public.agent_threads set updated_at = now() where id = current_thread_id;
  end if;

  insert into public.action_proposals (
    user_id, thread_id, agent, action, payload, summary, idempotency_key
  ) values (
    owner_id,
    current_thread_id,
    requested_agent,
    requested_action,
    coalesce(requested_payload, '{}'::jsonb),
    requested_summary,
    requested_idempotency_key
  )
  on conflict (user_id, idempotency_key) do nothing
  returning * into current_proposal;

  if current_proposal.id is null then
    select * into current_proposal
    from public.action_proposals
    where user_id = owner_id and idempotency_key = requested_idempotency_key;
  end if;

  insert into public.audit_logs (user_id, proposal_id, event_type, payload)
  values (owner_id, current_proposal.id, 'proposal_created', jsonb_build_object(
    'thread_id', current_thread_id,
    'agent', requested_agent,
    'action', requested_action
  ));

  return query select current_thread_id, to_jsonb(current_proposal);
end;
$$;

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
  task_title text;
  task_subject text;
  task_minutes integer;
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
    set payload = coalesce(edited_payload, payload),
        status = 'edited',
        decided_at = now()
    where id = current_proposal.id
    returning * into current_proposal;
  elsif requested_decision = 'reject' then
    update public.action_proposals
    set status = 'rejected', decided_at = now()
    where id = current_proposal.id
    returning * into current_proposal;
  else
    if current_proposal.action <> 'create_review_task' then
      raise exception 'unsupported proposal action';
    end if;
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

    update public.action_proposals
    set status = 'applied', decided_at = now(), applied_at = now()
    where id = current_proposal.id
    returning * into current_proposal;
  end if;

  insert into public.audit_logs (user_id, proposal_id, event_type, payload)
  values (owner_id, current_proposal.id, 'proposal_' || requested_decision, jsonb_build_object(
    'status', current_proposal.status,
    'action', current_proposal.action
  ));
  return current_proposal;
end;
$$;

revoke all on function public.create_agent_proposal(uuid, text, text, text, jsonb, text, text) from public;
grant execute on function public.create_agent_proposal(uuid, text, text, text, jsonb, text, text) to authenticated;
revoke all on function public.decide_agent_proposal(uuid, text, jsonb) from public;
grant execute on function public.decide_agent_proposal(uuid, text, jsonb) to authenticated;

grant select on public.agent_threads, public.action_proposals, public.audit_logs to authenticated;
