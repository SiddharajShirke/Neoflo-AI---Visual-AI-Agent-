create table public.deletion_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  session_id uuid,
  scope public.deletion_scope not null,
  reason public.deletion_reason not null default 'user',
  status public.deletion_status not null default 'requested',
  requested_at timestamptz not null default timezone('utc', now()),
  claimed_at timestamptz,
  completed_at timestamptz,
  failure_code text check (failure_code is null or char_length(failure_code) between 1 and 80),
  deleted_record_count integer not null default 0 check (deleted_record_count >= 0),
  deleted_object_count integer not null default 0 check (deleted_object_count >= 0),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (id, user_id),
  foreign key (session_id, user_id) references public.monitoring_sessions(id, user_id) on delete cascade,
  check ((scope = 'account' and session_id is null) or (scope = 'session' and session_id is not null)),
  check ((status = 'requested' and claimed_at is null and completed_at is null) or (status = 'claimed' and claimed_at is not null and completed_at is null) or (status in ('completed', 'failed') and claimed_at is not null and completed_at is not null)),
  check ((status = 'failed' and failure_code is not null) or (status <> 'failed' and failure_code is null))
);

create unique index deletion_requests_active_account_idx on public.deletion_requests(user_id)
  where scope = 'account' and status in ('requested', 'claimed');
create unique index deletion_requests_active_session_idx on public.deletion_requests(user_id, session_id)
  where scope = 'session' and status in ('requested', 'claimed');
create index deletion_requests_status_requested_at_idx on public.deletion_requests(status, requested_at);
create trigger deletion_requests_set_updated_at before update on public.deletion_requests for each row execute procedure public.set_updated_at();

alter table public.deletion_requests enable row level security;
alter table public.deletion_requests force row level security;
create policy deletion_requests_select_own on public.deletion_requests for select to authenticated using ((select auth.uid()) = user_id);
grant select on public.deletion_requests to authenticated;

select pgmq.create('event_processing');
select pgmq.create('deletion_processing');

create or replace function public.enqueue_event_processing(p_browser_event_id uuid)
returns bigint
language plpgsql
security definer
set search_path = public, pgmq, pg_catalog
as $$
declare
  message_id bigint;
begin
  if not exists (select 1 from public.browser_events where id = p_browser_event_id) then
    raise exception 'browser event does not exist' using errcode = 'P0001';
  end if;
  select * into message_id from pgmq.send(
    'event_processing',
    jsonb_build_object('browser_event_id', p_browser_event_id, 'contract_version', 1),
    0
  );
  return message_id;
end;
$$;

create or replace function public.enqueue_deletion_processing(p_deletion_request_id uuid)
returns bigint
language plpgsql
security definer
set search_path = public, pgmq, pg_catalog
as $$
declare
  message_id bigint;
begin
  if not exists (select 1 from public.deletion_requests where id = p_deletion_request_id) then
    raise exception 'deletion request does not exist' using errcode = 'P0001';
  end if;
  select * into message_id from pgmq.send(
    'deletion_processing',
    jsonb_build_object('deletion_request_id', p_deletion_request_id, 'contract_version', 1),
    0
  );
  return message_id;
end;
$$;

create or replace function public.claim_deletion_request(p_deletion_request_id uuid)
returns public.deletion_status
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  result_status public.deletion_status;
begin
  update public.deletion_requests
  set status = 'claimed', claimed_at = timezone('utc', now())
  where id = p_deletion_request_id and status = 'requested'
  returning status into result_status;
  if result_status is not null then return result_status; end if;
  select status into result_status from public.deletion_requests where id = p_deletion_request_id;
  if result_status is null then raise exception 'deletion request does not exist' using errcode = 'P0001'; end if;
  return result_status;
end;
$$;

create or replace function public.complete_deletion_request(p_deletion_request_id uuid, p_failure_code text default null)
returns public.deletion_status
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  result_status public.deletion_status;
begin
  update public.deletion_requests
  set status = case when p_failure_code is null then 'completed' else 'failed' end,
      completed_at = timezone('utc', now()),
      failure_code = p_failure_code
  where id = p_deletion_request_id and status = 'claimed'
  returning status into result_status;
  if result_status is not null then return result_status; end if;
  select status into result_status from public.deletion_requests where id = p_deletion_request_id;
  if result_status is null then raise exception 'deletion request does not exist' using errcode = 'P0001'; end if;
  return result_status;
end;
$$;

revoke all on schema pgmq from public, anon, authenticated;
revoke all on all tables in schema pgmq from public, anon, authenticated;
revoke execute on all functions in schema pgmq from public, anon, authenticated;
revoke execute on function public.enqueue_event_processing(uuid) from public, anon, authenticated;
revoke execute on function public.enqueue_deletion_processing(uuid) from public, anon, authenticated;
revoke execute on function public.claim_deletion_request(uuid) from public, anon, authenticated;
revoke execute on function public.complete_deletion_request(uuid, text) from public, anon, authenticated;
grant execute on function public.enqueue_event_processing(uuid) to service_role;
grant execute on function public.enqueue_deletion_processing(uuid) to service_role;
grant execute on function public.claim_deletion_request(uuid) to service_role;
grant execute on function public.complete_deletion_request(uuid, text) to service_role;
