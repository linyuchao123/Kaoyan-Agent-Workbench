-- v0.7: persist read-only Agent conversations without creating action proposals.
create or replace function public.ensure_agent_thread(
  requested_thread_id uuid,
  requested_mode text,
  requested_title text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_id uuid := auth.uid();
  current_thread_id uuid;
begin
  if owner_id is null then
    raise exception 'authentication required';
  end if;
  if requested_mode not in ('coach', 'tutor', 'combined') then
    raise exception 'unknown agent mode';
  end if;

  if requested_thread_id is null then
    insert into public.agent_threads (user_id, mode, title)
    values (owner_id, requested_mode, left(coalesce(nullif(requested_title, ''), '新对话'), 160))
    returning id into current_thread_id;
  else
    select id into current_thread_id
    from public.agent_threads
    where id = requested_thread_id and user_id = owner_id;
    if current_thread_id is null then
      raise exception 'agent thread not found';
    end if;
  end if;

  return current_thread_id;
end;
$$;

revoke all on function public.ensure_agent_thread(uuid, text, text) from public;
grant execute on function public.ensure_agent_thread(uuid, text, text) to authenticated;
