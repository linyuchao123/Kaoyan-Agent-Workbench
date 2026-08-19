-- v0.8: persist the selected Agent model profile and last actual provider.
alter table public.agent_threads
  add column if not exists model_profile text not null default 'flash'
    check (model_profile in ('flash', 'pro')),
  add column if not exists last_provider text,
  add column if not exists last_model text;

create or replace function public.set_agent_thread_model_profile(
  requested_thread_id uuid,
  requested_model_profile text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_id uuid := auth.uid();
begin
  if owner_id is null then
    raise exception 'authentication required';
  end if;
  if requested_model_profile not in ('flash', 'pro') then
    raise exception 'unknown model profile';
  end if;

  update public.agent_threads
  set model_profile = requested_model_profile,
      updated_at = now()
  where id = requested_thread_id and user_id = owner_id;

  if not found then
    raise exception 'agent thread not found';
  end if;
end;
$$;

create or replace function public.append_agent_exchange(
  requested_thread_id uuid,
  user_content text,
  agent_content text,
  agent_sources jsonb default '[]'::jsonb,
  agent_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_id uuid := auth.uid();
  requested_profile text := coalesce(agent_metadata ->> 'model_profile', 'flash');
begin
  if owner_id is null then
    raise exception 'authentication required';
  end if;
  if requested_profile not in ('flash', 'pro') then
    raise exception 'unknown model profile';
  end if;
  if not exists (
    select 1 from public.agent_threads
    where id = requested_thread_id and user_id = owner_id
  ) then
    raise exception 'agent thread not found';
  end if;
  if nullif(btrim(user_content), '') is null or nullif(btrim(agent_content), '') is null then
    raise exception 'agent exchange content is required';
  end if;

  insert into public.agent_messages (user_id, thread_id, role, content)
  values (owner_id, requested_thread_id, 'user', user_content);

  insert into public.agent_messages (user_id, thread_id, role, content, sources, metadata)
  values (
    owner_id,
    requested_thread_id,
    'agent',
    agent_content,
    coalesce(agent_sources, '[]'::jsonb),
    coalesce(agent_metadata, '{}'::jsonb)
  );

  update public.agent_threads
  set model_profile = requested_profile,
      last_provider = nullif(agent_metadata ->> 'provider', ''),
      last_model = nullif(agent_metadata ->> 'model', ''),
      updated_at = now()
  where id = requested_thread_id and user_id = owner_id;
end;
$$;

revoke all on function public.set_agent_thread_model_profile(uuid, text) from public;
grant execute on function public.set_agent_thread_model_profile(uuid, text) to authenticated;
revoke all on function public.append_agent_exchange(uuid, text, text, jsonb, jsonb) from public;
grant execute on function public.append_agent_exchange(uuid, text, text, jsonb, jsonb)
to authenticated;
