-- Forward-only Milestone 3 control-plane correction. This migration introduces
-- atomic service-role RPCs; no browser client receives direct database access.
do $$
begin
  if exists (
    select 1
    from public.consent_records
    where granted and revoked_at is null
    group by user_id, device_id, scope
    having count(*) > 1
  ) then
    raise exception
      'cannot add active-consent uniqueness: duplicate active grants require a semantic migration decision';
  end if;
end;
$$;

create unique index consent_records_one_active_grant_idx
  on public.consent_records(user_id, device_id, scope)
  where granted and revoked_at is null;

create or replace function public.create_consent_idempotent(
  p_user_id uuid,
  p_route text,
  p_device_id uuid,
  p_scope public.consent_scope,
  p_policy_version text,
  p_granted boolean,
  p_idempotency_key text,
  p_request_sha256 text
)
returns table (
  outcome text,
  response_status integer,
  consent_id uuid,
  consent_scope public.consent_scope,
  consent_granted boolean
)
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  saved_route text;
  saved_hash text;
  saved_status public.api_idempotency_status;
  saved_response_status integer;
  saved_metadata jsonb;
  inserted_count bigint;
  created_consent_id uuid;
begin
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 1 and 128
     or p_request_sha256 is null or p_request_sha256 !~ '^[A-Fa-f0-9]{64}$' then
    raise exception 'invalid idempotency input' using errcode = '22023';
  end if;

  insert into public.api_idempotency_records(user_id, route, idempotency_key, request_sha256)
  values (p_user_id, p_route, p_idempotency_key, p_request_sha256)
  on conflict (user_id, idempotency_key) do nothing;
  get diagnostics inserted_count = row_count;

  if inserted_count = 0 then
    select record.route, record.request_sha256, record.status,
           record.response_status, record.response_metadata
      into saved_route, saved_hash, saved_status, saved_response_status, saved_metadata
      from public.api_idempotency_records as record
      where record.user_id = p_user_id and record.idempotency_key = p_idempotency_key
      for update;
    if saved_route <> p_route or saved_hash <> p_request_sha256 then
      return query select 'conflict', null::integer, null::uuid,
        null::public.consent_scope, null::boolean;
      return;
    end if;
    if saved_status = 'completed' then
      return query select 'completed', saved_response_status,
        (saved_metadata->>'id')::uuid,
        (saved_metadata->>'scope')::public.consent_scope,
        (saved_metadata->>'granted')::boolean;
      return;
    end if;
    return query select 'in_progress', null::integer, null::uuid,
      null::public.consent_scope, null::boolean;
    return;
  end if;

  if not exists (
    select 1 from public.devices
    where id = p_device_id and user_id = p_user_id and status = 'active'
  ) then
    raise exception 'active owner device not found' using errcode = 'P0001';
  end if;

  update public.consent_records
  set revoked_at = timezone('utc', now())
  where user_id = p_user_id
    and device_id = p_device_id
    and scope = p_scope
    and granted
    and revoked_at is null;

  insert into public.consent_records(user_id, device_id, scope, policy_version, granted)
  values (p_user_id, p_device_id, p_scope, p_policy_version, p_granted)
  returning id into created_consent_id;

  update public.api_idempotency_records
  set status = 'completed',
      response_status = 201,
      response_metadata = jsonb_build_object(
        'id', created_consent_id,
        'scope', p_scope,
        'granted', p_granted
      )
  where user_id = p_user_id and idempotency_key = p_idempotency_key;

  return query select 'created', 201, created_consent_id, p_scope, p_granted;
end;
$$;

create or replace function public.create_monitoring_session_idempotent(
  p_user_id uuid,
  p_route text,
  p_device_id uuid,
  p_monitoring_consent_id uuid,
  p_screenshot_consent_id uuid,
  p_capture_policy_version text,
  p_started_at timestamptz,
  p_idempotency_key text,
  p_request_sha256 text
)
returns table (
  outcome text,
  response_status integer,
  session_id uuid,
  session_status public.monitoring_session_status
)
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  saved_route text;
  saved_hash text;
  saved_status public.api_idempotency_status;
  saved_response_status integer;
  saved_metadata jsonb;
  inserted_count bigint;
  created_session_id uuid;
  created_session_status public.monitoring_session_status;
begin
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 1 and 128
     or p_request_sha256 is null or p_request_sha256 !~ '^[A-Fa-f0-9]{64}$' then
    raise exception 'invalid idempotency input' using errcode = '22023';
  end if;

  insert into public.api_idempotency_records(user_id, route, idempotency_key, request_sha256)
  values (p_user_id, p_route, p_idempotency_key, p_request_sha256)
  on conflict (user_id, idempotency_key) do nothing;
  get diagnostics inserted_count = row_count;

  if inserted_count = 0 then
    select record.route, record.request_sha256, record.status,
           record.response_status, record.response_metadata
      into saved_route, saved_hash, saved_status, saved_response_status, saved_metadata
      from public.api_idempotency_records as record
      where record.user_id = p_user_id and record.idempotency_key = p_idempotency_key
      for update;
    if saved_route <> p_route or saved_hash <> p_request_sha256 then
      return query select 'conflict', null::integer, null::uuid,
        null::public.monitoring_session_status;
      return;
    end if;
    if saved_status = 'completed' then
      return query select 'completed', saved_response_status,
        (saved_metadata->>'id')::uuid,
        (saved_metadata->>'status')::public.monitoring_session_status;
      return;
    end if;
    return query select 'in_progress', null::integer, null::uuid,
      null::public.monitoring_session_status;
    return;
  end if;

  if not exists (
    select 1 from public.devices
    where id = p_device_id and user_id = p_user_id and status = 'active'
  ) then
    raise exception 'active owner device not found' using errcode = 'P0001';
  end if;

  insert into public.monitoring_sessions(
    user_id, device_id, monitoring_consent_id, screenshot_consent_id,
    capture_policy_version, started_at
  ) values (
    p_user_id, p_device_id, p_monitoring_consent_id, p_screenshot_consent_id,
    p_capture_policy_version, p_started_at
  ) returning id, status into created_session_id, created_session_status;

  update public.api_idempotency_records
  set status = 'completed',
      response_status = 201,
      response_metadata = jsonb_build_object(
        'id', created_session_id,
        'status', created_session_status
      )
  where user_id = p_user_id and idempotency_key = p_idempotency_key;

  return query select 'created', 201, created_session_id, created_session_status;
end;
$$;

create or replace function public.transition_monitoring_session_idempotent(
  p_user_id uuid,
  p_route text,
  p_session_id uuid,
  p_target public.monitoring_session_status,
  p_idempotency_key text,
  p_request_sha256 text
)
returns table (
  outcome text,
  response_status integer,
  session_id uuid,
  session_status public.monitoring_session_status
)
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  saved_route text;
  saved_hash text;
  saved_status public.api_idempotency_status;
  saved_response_status integer;
  saved_metadata jsonb;
  inserted_count bigint;
  transitioned_status public.monitoring_session_status;
begin
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 1 and 128
     or p_request_sha256 is null or p_request_sha256 !~ '^[A-Fa-f0-9]{64}$' then
    raise exception 'invalid idempotency input' using errcode = '22023';
  end if;

  insert into public.api_idempotency_records(user_id, route, idempotency_key, request_sha256)
  values (p_user_id, p_route, p_idempotency_key, p_request_sha256)
  on conflict (user_id, idempotency_key) do nothing;
  get diagnostics inserted_count = row_count;

  if inserted_count = 0 then
    select record.route, record.request_sha256, record.status,
           record.response_status, record.response_metadata
      into saved_route, saved_hash, saved_status, saved_response_status, saved_metadata
      from public.api_idempotency_records as record
      where record.user_id = p_user_id and record.idempotency_key = p_idempotency_key
      for update;
    if saved_route <> p_route or saved_hash <> p_request_sha256 then
      return query select 'conflict', null::integer, null::uuid,
        null::public.monitoring_session_status;
      return;
    end if;
    if saved_status = 'completed' then
      return query select 'completed', saved_response_status,
        (saved_metadata->>'id')::uuid,
        (saved_metadata->>'status')::public.monitoring_session_status;
      return;
    end if;
    return query select 'in_progress', null::integer, null::uuid,
      null::public.monitoring_session_status;
    return;
  end if;

  select public.transition_monitoring_session(p_session_id, p_user_id, p_target)
    into transitioned_status;

  update public.api_idempotency_records
  set status = 'completed',
      response_status = 200,
      response_metadata = jsonb_build_object(
        'id', p_session_id,
        'status', transitioned_status
      )
  where user_id = p_user_id and idempotency_key = p_idempotency_key;

  return query select 'created', 200, p_session_id, transitioned_status;
end;
$$;

revoke execute on function public.create_consent_idempotent(
  uuid, text, uuid, public.consent_scope, text, boolean, text, text
) from public, anon, authenticated;
revoke execute on function public.create_monitoring_session_idempotent(
  uuid, text, uuid, uuid, uuid, text, timestamptz, text, text
) from public, anon, authenticated;
revoke execute on function public.transition_monitoring_session_idempotent(
  uuid, text, uuid, public.monitoring_session_status, text, text
) from public, anon, authenticated;
grant execute on function public.create_consent_idempotent(
  uuid, text, uuid, public.consent_scope, text, boolean, text, text
) to service_role;
grant execute on function public.create_monitoring_session_idempotent(
  uuid, text, uuid, uuid, uuid, text, timestamptz, text, text
) to service_role;
grant execute on function public.transition_monitoring_session_idempotent(
  uuid, text, uuid, public.monitoring_session_status, text, text
) to service_role;
