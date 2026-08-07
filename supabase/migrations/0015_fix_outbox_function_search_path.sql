-- Forward-only corrective migration. Rollback, if ever required, must be a later
-- migration that restores a separately reviewed function definition.
create or replace function public.publish_event_outbox(p_limit integer default 50)
returns table (claimed_count integer, published_count integer, pending_count integer)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  outbox_row public.event_outbox%rowtype;
  queue_id bigint;
  published integer := 0;
begin
  if p_limit < 1 or p_limit > 100 then
    raise exception 'invalid outbox limit' using errcode = '22023';
  end if;
  for outbox_row in
    select * from public.event_outbox
    where status = 'pending' and available_at <= timezone('utc', now())
    order by created_at
    limit p_limit
    for update skip locked
  loop
    update public.event_outbox set claimed_at = timezone('utc', now()), attempt_count = attempt_count + 1
    where id = outbox_row.id;
    select * into queue_id from pgmq.send('event_processing', jsonb_build_object(
      'browser_event_id', outbox_row.browser_event_id,
      'contract_version', outbox_row.contract_version
    ), 0);
    update public.event_outbox
    set status = 'published', published_at = timezone('utc', now()), queue_message_id = queue_id
    where id = outbox_row.id;
    published := published + 1;
  end loop;
  return query select published, published,
    (select count(*)::integer from public.event_outbox where status = 'pending');
end;
$$;

revoke execute on function public.publish_event_outbox(integer) from public, anon, authenticated;
grant execute on function public.publish_event_outbox(integer) to service_role;
