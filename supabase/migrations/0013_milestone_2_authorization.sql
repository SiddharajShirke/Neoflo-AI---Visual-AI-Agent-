alter table public.api_idempotency_records enable row level security;
alter table public.api_idempotency_records force row level security;
alter table public.event_outbox enable row level security;
alter table public.event_outbox force row level security;

create policy api_idempotency_records_select_own on public.api_idempotency_records
  for select to authenticated using ((select auth.uid()) = user_id);

revoke all on public.api_idempotency_records from public, anon, authenticated;
revoke all on public.event_outbox from public, anon, authenticated;
revoke execute on function public.transition_monitoring_session(uuid, uuid, public.monitoring_session_status)
  from public, anon, authenticated;
revoke execute on function public.publish_event_outbox(integer) from public, anon, authenticated;
revoke execute on function public.ingest_browser_event_batch(uuid, text, uuid, uuid, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.transition_monitoring_session(uuid, uuid, public.monitoring_session_status) to service_role;
grant execute on function public.publish_event_outbox(integer) to service_role;
grant execute on function public.ingest_browser_event_batch(uuid, text, uuid, uuid, jsonb, text, text) to service_role;

-- One idempotent asynchronous request per session; actual deletion stays deferred.
create unique index deletion_requests_one_session_idx
  on public.deletion_requests(user_id, session_id) where session_id is not null;

create or replace function public.prepare_session_deletion_request(
  p_session_id uuid,
  p_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  request_id uuid;
begin
  if not exists (
    select 1 from public.monitoring_sessions
    where id = p_session_id and user_id = p_user_id and status in ('completed', 'cancelled')
  ) then
    raise exception 'terminal owner-scoped session not found' using errcode = 'P0001';
  end if;
  insert into public.deletion_requests(user_id, session_id, scope, reason, status)
  values (p_user_id, p_session_id, 'session', 'user', 'requested')
  on conflict (user_id, session_id) where session_id is not null
  do update set updated_at = public.deletion_requests.updated_at
  returning id into request_id;
  return request_id;
end;
$$;

revoke execute on function public.prepare_session_deletion_request(uuid, uuid) from public, anon, authenticated;
grant execute on function public.prepare_session_deletion_request(uuid, uuid) to service_role;
