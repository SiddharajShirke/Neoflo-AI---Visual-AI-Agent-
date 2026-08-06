create or replace function public.ingest_browser_event_batch(
  p_user_id uuid, p_route text, p_device_id uuid, p_session_id uuid,
  p_events jsonb, p_idempotency_key text, p_request_sha256 text
)
returns table (outcome text, response_status integer, accepted_count integer, duplicate_count integer)
language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  event_data jsonb;
  event_id uuid;
  existing_fingerprint text;
  accepted integer := 0;
  duplicates integer := 0;
  record_status public.api_idempotency_status;
  stored_route text;
  saved_hash text;
  saved_metadata jsonb;
  saved_response_status integer;
  claimed boolean := false;
  inserted_count bigint;
begin
  if p_idempotency_key is null or p_request_sha256 is null then
    raise exception 'idempotency key and request hash are required' using errcode = '22023';
  end if;
  insert into public.api_idempotency_records(user_id, route, idempotency_key, request_sha256)
  values (p_user_id, p_route, p_idempotency_key, p_request_sha256)
  on conflict (user_id, idempotency_key) do nothing;
  get diagnostics inserted_count = row_count;
  claimed := inserted_count > 0;
  if not claimed then
    select record.route, record.request_sha256, record.status, record.response_status, record.response_metadata
      into stored_route, saved_hash, record_status, saved_response_status, saved_metadata
    from public.api_idempotency_records as record
    where record.user_id = p_user_id and record.idempotency_key = p_idempotency_key
    for update;
    if stored_route <> p_route or saved_hash <> p_request_sha256 then
      return query select 'conflict', null::integer, null::integer, null::integer;
      return;
    end if;
    if record_status = 'completed' then
      return query select 'completed', saved_response_status, (saved_metadata->>'accepted_count')::integer, (saved_metadata->>'duplicate_count')::integer;
      return;
    end if;
    return query select 'in_progress', null::integer, null::integer, null::integer;
    return;
  end if;
  if jsonb_typeof(p_events) <> 'array' or jsonb_array_length(p_events) < 1 or jsonb_array_length(p_events) > 100 then
    raise exception 'invalid event batch' using errcode = '22023';
  end if;
  if not exists (select 1 from public.devices where id = p_device_id and user_id = p_user_id and status = 'active') then
    raise exception 'active owner device not found' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.monitoring_sessions s join public.consent_records c on c.id = s.monitoring_consent_id where s.id = p_session_id and s.user_id = p_user_id and s.device_id = p_device_id and s.status = 'recording' and c.user_id = p_user_id and c.device_id = p_device_id and c.scope = 'monitoring' and c.granted and c.revoked_at is null) then
    raise exception 'recording session with active consent not found' using errcode = 'P0001';
  end if;
  for event_data in select value from jsonb_array_elements(p_events) loop
    select event_fingerprint into existing_fingerprint from public.browser_events where device_id = p_device_id and client_event_id = event_data->>'client_event_id';
    if existing_fingerprint is not null then
      if existing_fingerprint <> event_data->>'event_fingerprint' then raise exception 'event identifier reused with different content' using errcode = '23505'; end if;
      duplicates := duplicates + 1;
      continue;
    end if;
    insert into public.browser_events(user_id, device_id, session_id, client_event_id, sequence_number, event_kind, occurred_at, page_origin, page_path_hash, page_title_redacted, accessibility_context_redacted, context_sha256, capture_policy_version, event_fingerprint)
    values (p_user_id, p_device_id, p_session_id, event_data->>'client_event_id', (event_data->>'sequence_number')::bigint, (event_data->>'event_kind')::public.browser_event_kind, (event_data->>'occurred_at')::timestamptz, event_data->>'page_origin', event_data->>'page_path_hash', event_data->>'page_title_redacted', event_data->>'accessibility_context_redacted', event_data->>'context_sha256', event_data->>'capture_policy_version', event_data->>'event_fingerprint') returning id into event_id;
    insert into public.event_outbox(browser_event_id) values (event_id);
    accepted := accepted + 1;
  end loop;
  update public.api_idempotency_records set status = 'completed', response_status = 202, response_metadata = jsonb_build_object('accepted_count', accepted, 'duplicate_count', duplicates) where user_id = p_user_id and idempotency_key = p_idempotency_key;
  return query select 'created', 202, accepted, duplicates;
end;
$$;
