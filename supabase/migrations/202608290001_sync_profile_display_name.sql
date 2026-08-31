-- v1.1: keep the public profile display name aligned with trusted Auth metadata.
-- The browser updates auth.users through Supabase Auth; this trigger owns the profile write.
create or replace function public.sync_profile_display_name()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
  set
    display_name = coalesce(
      nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''),
      split_part(new.email, '@', 1)
    ),
    updated_at = now()
  where id = new.id;

  return new;
end;
$$;

drop trigger if exists on_auth_user_display_name_updated on auth.users;
create trigger on_auth_user_display_name_updated
after update of raw_user_meta_data on auth.users
for each row
when (old.raw_user_meta_data is distinct from new.raw_user_meta_data)
execute function public.sync_profile_display_name();

update public.profiles as profile
set
  display_name = coalesce(
    nullif(btrim(auth_user.raw_user_meta_data ->> 'display_name'), ''),
    profile.display_name,
    split_part(auth_user.email, '@', 1)
  ),
  updated_at = now()
from auth.users as auth_user
where profile.id = auth_user.id;

revoke all on function public.sync_profile_display_name() from public;
