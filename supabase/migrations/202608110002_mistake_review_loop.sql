-- v0.4: atomically record a mistake review and schedule the next review.
create or replace function public.review_mistake_card(
  p_card_id uuid,
  p_result text
)
returns setof public.mistake_cards
language plpgsql
set search_path = public
as $$
declare
  current_card public.mistake_cards%rowtype;
  next_mastery integer;
  interval_days integer;
begin
  if p_result not in ('again', 'hard', 'good', 'easy') then
    raise exception 'invalid review result' using errcode = '22023';
  end if;

  select * into current_card
  from public.mistake_cards
  where id = p_card_id and user_id = auth.uid()
  for update;

  if not found then
    return;
  end if;

  next_mastery := greatest(
    1,
    least(
      5,
      current_card.mastery + case p_result
        when 'again' then -1
        when 'hard' then 0
        when 'good' then 1
        else 2
      end
    )
  );
  interval_days := case p_result
    when 'again' then 1
    when 'hard' then 3
    when 'good' then 7
    else 14
  end;

  insert into public.review_events (
    user_id,
    mistake_card_id,
    result,
    mastery_before,
    mastery_after
  ) values (
    auth.uid(),
    current_card.id,
    p_result,
    current_card.mastery,
    next_mastery
  );

  return query
  update public.mistake_cards
  set mastery = next_mastery,
      review_count = review_count + 1,
      next_review_at = now() + make_interval(days => interval_days)
  where id = current_card.id and user_id = auth.uid()
  returning *;
end;
$$;

revoke all on function public.review_mistake_card(uuid, text) from public;
grant execute on function public.review_mistake_card(uuid, text) to authenticated;
grant select, insert, update on public.mistake_cards to authenticated;
grant select, insert on public.review_events to authenticated;
