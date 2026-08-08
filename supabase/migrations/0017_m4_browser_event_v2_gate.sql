-- Forward-only Milestone 4-A database gate. Historical v1 columns and rows keep
-- their original meaning; rollback requires a separately reviewed migration.

alter table public.browser_events
  add column page_domain text,
  add column transition_type text,
  add column client_event_uuid uuid,
  add column event_contract_version smallint not null default 1;

alter table public.browser_events
  add constraint browser_events_contract_version_check
    check (event_contract_version in (1, 2)),
  add constraint browser_events_v2_shape_check check (
    event_contract_version <> 2
    or (
      event_kind = 'navigation'
      and client_event_uuid is not null
      and client_event_id = client_event_uuid::text
      and sequence_number > 0
      and event_fingerprint is not null
      and page_domain is not null
      and transition_type is not null
      and page_origin is null
      and page_path_hash is null
      and page_title_redacted is null
      and accessibility_context_redacted is null
      and context_sha256 is null
    )
  ),
  add constraint browser_events_v2_domain_check check (
    event_contract_version <> 2
    or (
      char_length(page_domain) between 4 and 253
      and page_domain = lower(page_domain)
      and page_domain ~ '^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$'
    )
  ),
  add constraint browser_events_v2_transition_check check (
    event_contract_version <> 2
    or transition_type in (
      'link', 'typed', 'auto_bookmark', 'generated', 'start_page',
      'form_submit', 'reload', 'keyword', 'keyword_generated'
    )
  ),
  add constraint browser_events_v2_uuid_check check (
    event_contract_version <> 2
    or client_event_id = client_event_uuid::text
  ),
  add constraint browser_events_v2_sequence_check check (
    event_contract_version <> 2 or sequence_number > 0
  );

create unique index browser_events_v2_device_client_uuid_idx
  on public.browser_events(device_id, client_event_uuid)
  where event_contract_version = 2;

alter table public.event_outbox
  drop constraint event_outbox_contract_version_check,
  add constraint event_outbox_contract_version_check
    check (contract_version in (1, 2));

create or replace function public.ingest_browser_event_batch(
  p_user_id uuid,
  p_route text,
  p_device_id uuid,
  p_session_id uuid,
  p_events jsonb,
  p_idempotency_key text,
  p_request_sha256 text
)
returns table (
  outcome text,
  response_status integer,
  accepted_count integer,
  duplicate_count integer
)
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  event_data jsonb;
  event_id uuid;
  parsed_client_event_id uuid;
  existing_contract_version smallint;
  existing_fingerprint text;
  accepted integer := 0;
  duplicates integer := 0;
  record_status public.api_idempotency_status;
  stored_route text;
  saved_hash text;
  saved_metadata jsonb;
  saved_response_status integer;
  inserted_count bigint;
  device_state public.device_status;
  session_state public.monitoring_session_status;
  session_policy_version text;
  session_consent_id uuid;
begin
  if p_idempotency_key is null
     or char_length(p_idempotency_key) not between 1 and 128
     or p_request_sha256 is null
     or p_request_sha256 !~ '^[A-Fa-f0-9]{64}$' then
    raise exception 'invalid idempotency input' using errcode = '22023';
  end if;

  insert into public.api_idempotency_records(
    user_id, route, idempotency_key, request_sha256
  ) values (
    p_user_id, p_route, p_idempotency_key, p_request_sha256
  ) on conflict (user_id, idempotency_key) do nothing;
  get diagnostics inserted_count = row_count;

  if inserted_count = 0 then
    select record.route, record.request_sha256, record.status,
           record.response_status, record.response_metadata
      into stored_route, saved_hash, record_status,
           saved_response_status, saved_metadata
    from public.api_idempotency_records as record
    where record.user_id = p_user_id
      and record.idempotency_key = p_idempotency_key
    for update;

    if stored_route <> p_route or saved_hash <> p_request_sha256 then
      return query select 'conflict', null::integer, null::integer, null::integer;
      return;
    end if;
    if record_status = 'completed' then
      return query select
        'completed', saved_response_status,
        (saved_metadata->>'accepted_count')::integer,
        (saved_metadata->>'duplicate_count')::integer;
      return;
    end if;
    return query select 'in_progress', null::integer, null::integer, null::integer;
    return;
  end if;

  if jsonb_typeof(p_events) <> 'array'
     or jsonb_array_length(p_events) < 1
     or jsonb_array_length(p_events) > 100 then
    raise exception 'invalid event batch' using errcode = '22023';
  end if;

  for event_data in select value from jsonb_array_elements(p_events)
  loop
    if jsonb_typeof(event_data) is distinct from 'object'
       or not (event_data ?& array[
         'client_event_id', 'sequence_number', 'event_kind', 'occurred_at',
         'page_domain', 'transition_type', 'capture_policy_version',
         'event_fingerprint'
       ])
       or event_data - array[
         'client_event_id', 'sequence_number', 'event_kind', 'occurred_at',
         'page_domain', 'transition_type', 'capture_policy_version',
         'event_fingerprint'
       ] <> '{}'::jsonb
       or jsonb_typeof(event_data->'client_event_id') is distinct from 'string'
       or jsonb_typeof(event_data->'sequence_number') is distinct from 'number'
       or jsonb_typeof(event_data->'event_kind') is distinct from 'string'
       or jsonb_typeof(event_data->'occurred_at') is distinct from 'string'
       or jsonb_typeof(event_data->'page_domain') is distinct from 'string'
       or jsonb_typeof(event_data->'transition_type') is distinct from 'string'
       or jsonb_typeof(event_data->'capture_policy_version') is distinct from 'string'
       or jsonb_typeof(event_data->'event_fingerprint') is distinct from 'string' then
      raise exception 'invalid v2 event shape' using errcode = '22023';
    end if;

    begin
      parsed_client_event_id := (event_data->>'client_event_id')::uuid;
    exception when invalid_text_representation then
      raise exception 'invalid v2 client event UUID' using errcode = '22023';
    end;

    if (event_data->>'sequence_number') !~ '^[0-9]+$'
       or (event_data->>'sequence_number')::numeric > 9223372036854775807
       or (event_data->>'sequence_number')::bigint <= 0
       or event_data->>'event_kind' <> 'navigation'
       or char_length(event_data->>'page_domain') not between 4 and 253
       or event_data->>'page_domain' <> lower(event_data->>'page_domain')
       or (event_data->>'page_domain') !~ '^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$'
       or event_data->>'transition_type' not in (
         'link', 'typed', 'auto_bookmark', 'generated', 'start_page',
         'form_submit', 'reload', 'keyword', 'keyword_generated'
       )
       or char_length(event_data->>'capture_policy_version') not between 1 and 64
       or (event_data->>'event_fingerprint') !~ '^[A-Fa-f0-9]{64}$' then
      raise exception 'invalid v2 event shape' using errcode = '22023';
    end if;

    begin
      perform (event_data->>'occurred_at')::timestamptz;
    exception when others then
      raise exception 'invalid v2 event timestamp' using errcode = '22023';
    end;
  end loop;

  select device.status
    into device_state
  from public.devices as device
  where device.id = p_device_id and device.user_id = p_user_id;
  if not found or device_state <> 'active' then
    delete from public.api_idempotency_records
    where user_id = p_user_id and idempotency_key = p_idempotency_key;
    return query select 'device_inactive', null::integer, null::integer, null::integer;
    return;
  end if;

  select session.status, session.capture_policy_version, session.monitoring_consent_id
    into session_state, session_policy_version, session_consent_id
  from public.monitoring_sessions as session
  where session.id = p_session_id
    and session.user_id = p_user_id
    and session.device_id = p_device_id;
  if not found or session_state <> 'recording' then
    delete from public.api_idempotency_records
    where user_id = p_user_id and idempotency_key = p_idempotency_key;
    return query select 'session_not_recording', null::integer, null::integer, null::integer;
    return;
  end if;

  if not exists (
    select 1
    from public.consent_records as consent
    where consent.id = session_consent_id
      and consent.user_id = p_user_id
      and consent.device_id = p_device_id
      and consent.scope = 'monitoring'
      and consent.granted
      and consent.revoked_at is null
  ) then
    delete from public.api_idempotency_records
    where user_id = p_user_id and idempotency_key = p_idempotency_key;
    return query select 'consent_inactive', null::integer, null::integer, null::integer;
    return;
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_events) as item(value)
    where item.value->>'capture_policy_version' <> session_policy_version
  ) then
    delete from public.api_idempotency_records
    where user_id = p_user_id and idempotency_key = p_idempotency_key;
    return query select 'policy_mismatch', null::integer, null::integer, null::integer;
    return;
  end if;

  for event_data in select value from jsonb_array_elements(p_events)
  loop
    event_id := null;
    parsed_client_event_id := (event_data->>'client_event_id')::uuid;

    insert into public.browser_events(
      user_id, device_id, session_id, client_event_id, client_event_uuid,
      sequence_number, event_kind, occurred_at, page_domain, transition_type,
      capture_policy_version, event_fingerprint, event_contract_version,
      page_origin, page_path_hash, page_title_redacted,
      accessibility_context_redacted, context_sha256
    ) values (
      p_user_id, p_device_id, p_session_id,
      parsed_client_event_id::text, parsed_client_event_id,
      (event_data->>'sequence_number')::bigint, 'navigation',
      (event_data->>'occurred_at')::timestamptz,
      event_data->>'page_domain', event_data->>'transition_type',
      event_data->>'capture_policy_version', event_data->>'event_fingerprint', 2,
      null, null, null, null, null
    )
    on conflict do nothing
    returning id into event_id;

    if event_id is not null then
      insert into public.event_outbox(browser_event_id, contract_version)
      values (event_id, 2);
      accepted := accepted + 1;
      continue;
    end if;

    select existing.event_contract_version, existing.event_fingerprint
      into existing_contract_version, existing_fingerprint
    from public.browser_events as existing
    where existing.device_id = p_device_id
      and (
        existing.client_event_uuid = parsed_client_event_id
        or existing.client_event_id = parsed_client_event_id::text
      )
    for update;

    if not found then
      raise exception 'event sequence number already exists' using errcode = '23505';
    end if;
    if existing_contract_version <> 2
       or existing_fingerprint <> event_data->>'event_fingerprint' then
      raise exception 'event identifier reused with different content' using errcode = '23505';
    end if;
    duplicates := duplicates + 1;
  end loop;

  update public.api_idempotency_records
  set status = 'completed',
      response_status = 202,
      response_metadata = jsonb_build_object(
        'accepted_count', accepted,
        'duplicate_count', duplicates
      )
  where user_id = p_user_id and idempotency_key = p_idempotency_key;

  return query select 'created', 202, accepted, duplicates;
end;
$$;

revoke execute on function public.ingest_browser_event_batch(
  uuid, text, uuid, uuid, jsonb, text, text
) from public, anon, authenticated;
grant execute on function public.ingest_browser_event_batch(
  uuid, text, uuid, uuid, jsonb, text, text
) to service_role;

comment on column public.browser_events.client_event_uuid is
  'M4 v2 RFC 4122 client identity. The historical v1 text identity remains unchanged.';
comment on column public.browser_events.page_domain is
  'M4 v2 normalized domain only; never a URL, origin, host with port, path, query, or fragment.';
comment on function public.ingest_browser_event_batch(
  uuid, text, uuid, uuid, jsonb, text, text
) is
  'Service-role-only transactional v2 ingestion with typed authorization-state outcomes.';
