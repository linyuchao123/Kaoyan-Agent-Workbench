-- v0.7: persist traceable user/Agent exchanges inside an owned thread.
create table if not exists public.agent_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  thread_id uuid not null references public.agent_threads(id) on delete cascade,
  role text not null check (role in ('user', 'agent')),
  content text not null,
  sources jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists agent_messages_user_thread_created_idx
  on public.agent_messages(user_id, thread_id, created_at, id);

alter table public.agent_messages enable row level security;

drop policy if exists agent_messages_owner_select on public.agent_messages;
create policy agent_messages_owner_select
on public.agent_messages for select to authenticated
using (user_id = auth.uid());

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
begin
  if owner_id is null then
    raise exception 'authentication required';
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
  set updated_at = now()
  where id = requested_thread_id and user_id = owner_id;
end;
$$;

revoke all on function public.append_agent_exchange(uuid, text, text, jsonb, jsonb) from public;
grant execute on function public.append_agent_exchange(uuid, text, text, jsonb, jsonb)
to authenticated;
grant select on public.agent_messages to authenticated;
