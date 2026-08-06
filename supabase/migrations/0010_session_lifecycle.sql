-- Milestone 2: explicit recording lifecycle. This migration deliberately aborts
-- rather than assigning a meaning to historical `expired` rows.
do $$
declare
  active_count bigint;
  stopped_count bigint;
  expired_count bigint;
  unexpected_count bigint;
  constraint_name text;
begin
  select count(*) filter (where status::text = 'active'),
         count(*) filter (where status::text = 'stopped'),
         count(*) filter (where status::text = 'expired'),
         count(*) filter (where status::text not in ('active', 'paused', 'stopped', 'expired'))
    into active_count, stopped_count, expired_count, unexpected_count
  from public.monitoring_sessions;
  raise notice 'monitoring session state counts: active=%, stopped=%, expired=%, unexpected=%',
    active_count, stopped_count, expired_count, unexpected_count;
  if expired_count > 0 then
    raise exception 'cannot migrate monitoring_sessions: % expired rows require a semantic migration decision', expired_count;
  end if;
  if unexpected_count > 0 then
    raise exception 'cannot migrate monitoring_sessions: % unexpected legacy status rows', unexpected_count;
  end if;
  for constraint_name in
    select conname from pg_constraint
    where conrelid = 'public.monitoring_sessions'::regclass
      and contype = 'c'
      and (select attnum from pg_attribute
           where attrelid = 'public.monitoring_sessions'::regclass
             and attname = 'status') = any(conkey)
  loop
    execute format('alter table public.monitoring_sessions drop constraint %I', constraint_name);
  end loop;
end;
$$;

alter table public.monitoring_sessions alter column status drop default;

create type public.monitoring_session_status_v2 as enum ('recording', 'paused', 'completed', 'cancelled');

alter table public.monitoring_sessions
  alter column status type public.monitoring_session_status_v2
  using (
    case status::text
      when 'active' then 'recording'
      when 'paused' then 'paused'
      when 'stopped' then 'completed'
      else status::text
    end::public.monitoring_session_status_v2
  );

drop type public.monitoring_session_status;
alter type public.monitoring_session_status_v2 rename to monitoring_session_status;

alter table public.monitoring_sessions alter column status set default 'recording';

alter table public.monitoring_sessions
  add constraint monitoring_sessions_lifecycle_times_check check (
    (ended_at is null and status in ('recording', 'paused'))
    or (ended_at is not null and status in ('completed', 'cancelled'))
  );

create index monitoring_sessions_user_status_started_at_idx
  on public.monitoring_sessions(user_id, status, started_at desc);

do $$
begin
  if exists (select 1 from public.monitoring_sessions where status::text in ('active', 'stopped', 'expired')) then
    raise exception 'legacy monitoring session status remains after conversion';
  end if;
end;
$$;

create or replace function public.transition_monitoring_session(
  p_session_id uuid,
  p_user_id uuid,
  p_target public.monitoring_session_status
)
returns public.monitoring_session_status
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  current_status public.monitoring_session_status;
begin
  select status into current_status from public.monitoring_sessions
  where id = p_session_id and user_id = p_user_id for update;
  if current_status is null then
    raise exception 'session not found' using errcode = 'P0001';
  end if;
  if not ((current_status = 'recording' and p_target in ('paused', 'completed', 'cancelled'))
       or (current_status = 'paused' and p_target in ('recording', 'completed', 'cancelled'))) then
    raise exception 'invalid session transition' using errcode = 'P0001';
  end if;
  update public.monitoring_sessions
  set status = p_target,
      ended_at = case when p_target in ('completed', 'cancelled') then timezone('utc', now()) else null end
  where id = p_session_id and user_id = p_user_id;
  return p_target;
end;
$$;
