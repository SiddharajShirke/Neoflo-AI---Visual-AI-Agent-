begin;
set local search_path = extensions, public, pgmq, auth, pg_catalog;
select plan(51);

select has_column('public', 'browser_events', 'page_domain', 'v2 page domain exists');
select has_column('public', 'browser_events', 'transition_type', 'v2 transition type exists');
select has_column('public', 'browser_events', 'client_event_uuid', 'v2 UUID identity exists');
select has_column('public', 'browser_events', 'event_contract_version', 'event contract version exists');
select col_default_is(
  'public', 'browser_events', 'event_contract_version', '1',
  'historical rows default to contract version 1'
);
select has_index(
  'public', 'browser_events', 'browser_events_v2_device_client_uuid_idx',
  'v2 client UUID identity is unique per device'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.ingest_browser_event_batch(uuid, text, uuid, uuid, jsonb, text, text)',
    'execute'
  ),
  'service role may invoke v2 ingestion'
);
select is(
  (select count(*) from information_schema.routine_privileges
   where specific_schema = 'public'
     and routine_name = 'ingest_browser_event_batch'
     and grantee = 'PUBLIC'
     and privilege_type = 'EXECUTE'),
  0::bigint,
  'PUBLIC has no v2 ingestion grant'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.ingest_browser_event_batch(uuid, text, uuid, uuid, jsonb, text, text)',
    'execute'
  ),
  'anonymous users cannot invoke v2 ingestion'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.ingest_browser_event_batch(uuid, text, uuid, uuid, jsonb, text, text)',
    'execute'
  ),
  'authenticated users cannot invoke v2 ingestion'
);
select ok(
  (select prosecdef from pg_proc
   where oid = 'public.ingest_browser_event_batch(uuid, text, uuid, uuid, jsonb, text, text)'::regprocedure),
  'v2 ingestion remains security definer'
);
select is(
  (select count(*) from pg_policies
   where schemaname = 'public' and tablename = 'browser_events'
     and policyname = 'browser_events_select_own'),
  1::bigint,
  'browser event owner-read RLS policy remains present'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'm4-a@example.test', 'not-a-real-password', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-4000-8000-0000000000b2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'm4-b@example.test', 'not-a-real-password', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-4000-8000-0000000000c3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'm4-c@example.test', 'not-a-real-password', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-4000-8000-0000000000d4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'm4-d@example.test', 'not-a-real-password', '{}'::jsonb, '{}'::jsonb, now(), now());

insert into public.devices (id, user_id, installation_id, status) values
  ('10000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000a1', 'm4-test-device-a001', 'active'),
  ('10000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-0000000000b2', 'm4-test-device-b002', 'active'),
  ('10000000-0000-4000-8000-0000000000c3', '00000000-0000-4000-8000-0000000000c3', 'm4-test-device-c003', 'active'),
  ('10000000-0000-4000-8000-0000000000d4', '00000000-0000-4000-8000-0000000000d4', 'm4-test-device-d004', 'revoked');

insert into public.consent_records (
  id, user_id, device_id, scope, policy_version, granted
) values
  ('20000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1', 'monitoring', 'm4-navigation-v1', true),
  ('20000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-0000000000b2', '10000000-0000-4000-8000-0000000000b2', 'monitoring', 'm4-navigation-v1', true),
  ('20000000-0000-4000-8000-0000000000c3', '00000000-0000-4000-8000-0000000000c3', '10000000-0000-4000-8000-0000000000c3', 'monitoring', 'm4-navigation-v1', true),
  ('20000000-0000-4000-8000-0000000000d4', '00000000-0000-4000-8000-0000000000d4', '10000000-0000-4000-8000-0000000000d4', 'monitoring', 'm4-navigation-v1', true);

insert into public.monitoring_sessions (
  id, user_id, device_id, monitoring_consent_id, status, started_at,
  ended_at, capture_policy_version
) values
  ('30000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1', '20000000-0000-4000-8000-0000000000a1', 'recording', now() - interval '1 minute', null, 'm4-navigation-v1'),
  ('30000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1', '20000000-0000-4000-8000-0000000000a1', 'paused', now() - interval '1 minute', null, 'm4-navigation-v1'),
  ('30000000-0000-4000-8000-0000000000a3', '00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1', '20000000-0000-4000-8000-0000000000a1', 'completed', now() - interval '2 minutes', now() - interval '1 minute', 'm4-navigation-v1'),
  ('30000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-0000000000b2', '10000000-0000-4000-8000-0000000000b2', '20000000-0000-4000-8000-0000000000b2', 'recording', now() - interval '1 minute', null, 'm4-navigation-v1'),
  ('30000000-0000-4000-8000-0000000000c3', '00000000-0000-4000-8000-0000000000c3', '10000000-0000-4000-8000-0000000000c3', '20000000-0000-4000-8000-0000000000c3', 'recording', now() - interval '1 minute', null, 'm4-navigation-v1'),
  ('30000000-0000-4000-8000-0000000000d4', '00000000-0000-4000-8000-0000000000d4', '10000000-0000-4000-8000-0000000000d4', '20000000-0000-4000-8000-0000000000d4', 'recording', now() - interval '1 minute', null, 'm4-navigation-v1');

update public.consent_records
set revoked_at = timezone('utc', now())
where id = '20000000-0000-4000-8000-0000000000c3';

insert into public.browser_events (
  id, user_id, device_id, session_id, client_event_id, sequence_number,
  event_kind, occurred_at, page_origin, page_title_redacted,
  capture_policy_version
) values (
  '40000000-0000-4000-8000-0000000000b1',
  '00000000-0000-4000-8000-0000000000b2',
  '10000000-0000-4000-8000-0000000000b2',
  '30000000-0000-4000-8000-0000000000b2',
  'historical-v1-event', 0, 'meaningful_action', now() - interval '10 seconds',
  'https://example.test', 'historical synthetic title', 'historical-v1'
);
select is(
  (select event_contract_version from public.browser_events
   where id = '40000000-0000-4000-8000-0000000000b1'),
  1::smallint,
  'v1 rows retain historical fields and default contract version 1'
);

insert into public.browser_events (
  id, user_id, device_id, session_id, client_event_id, client_event_uuid,
  sequence_number, event_kind, occurred_at, page_domain, transition_type,
  capture_policy_version, event_fingerprint, event_contract_version
) values (
  '40000000-0000-4000-8000-0000000000b2',
  '00000000-0000-4000-8000-0000000000b2',
  '10000000-0000-4000-8000-0000000000b2',
  '30000000-0000-4000-8000-0000000000b2',
  '41111111-1111-4111-8111-111111111111',
  '41111111-1111-4111-8111-111111111111',
  1, 'navigation', now() - interval '9 seconds', 'example.test', 'link',
  'm4-navigation-v1', repeat('b', 64), 2
);
select is(
  (select client_event_uuid from public.browser_events
   where id = '40000000-0000-4000-8000-0000000000b2'),
  '41111111-1111-4111-8111-111111111111'::uuid,
  'a valid v2 row persists UUID identity'
);

select throws_ok(
  $$insert into public.browser_events (
      user_id, device_id, session_id, client_event_id, client_event_uuid,
      sequence_number, event_kind, occurred_at, page_domain, transition_type,
      page_title_redacted, capture_policy_version, event_contract_version
    ) values (
      '00000000-0000-4000-8000-0000000000b2', '10000000-0000-4000-8000-0000000000b2',
      '30000000-0000-4000-8000-0000000000b2', '42222222-2222-4222-8222-222222222222',
      '42222222-2222-4222-8222-222222222222', 2, 'navigation', now(),
      'example.test', 'link', 'must-be-null', 'm4-navigation-v1', 2)$$,
  '23514', null, 'v2 rejects legacy content columns'
);
select throws_ok(
  $$insert into public.browser_events (
      user_id, device_id, session_id, client_event_id, client_event_uuid,
      sequence_number, event_kind, occurred_at, page_domain, transition_type,
      capture_policy_version, event_contract_version
    ) values (
      '00000000-0000-4000-8000-0000000000b2', '10000000-0000-4000-8000-0000000000b2',
      '30000000-0000-4000-8000-0000000000b2', '43333333-3333-4333-8333-333333333333',
      '43333333-3333-4333-8333-333333333333', 2, 'meaningful_action', now(),
      'example.test', 'link', 'm4-navigation-v1', 2)$$,
  '23514', null, 'v2 requires navigation kind'
);
select throws_ok(
  $$insert into public.browser_events (
      user_id, device_id, session_id, client_event_id, client_event_uuid,
      sequence_number, event_kind, occurred_at, transition_type,
      capture_policy_version, event_contract_version
    ) values (
      '00000000-0000-4000-8000-0000000000b2', '10000000-0000-4000-8000-0000000000b2',
      '30000000-0000-4000-8000-0000000000b2', '44444444-4444-4444-8444-444444444444',
      '44444444-4444-4444-8444-444444444444', 2, 'navigation', now(),
      'link', 'm4-navigation-v1', 2)$$,
  '23514', null, 'v2 requires page domain'
);
select throws_ok(
  $$insert into public.browser_events (
      user_id, device_id, session_id, client_event_id, client_event_uuid,
      sequence_number, event_kind, occurred_at, page_domain, transition_type,
      capture_policy_version, event_contract_version
    ) values (
      '00000000-0000-4000-8000-0000000000b2', '10000000-0000-4000-8000-0000000000b2',
      '30000000-0000-4000-8000-0000000000b2', '45555555-5555-4555-8555-555555555555',
      '45555555-5555-4555-8555-555555555555', 2, 'navigation', now(),
      'https://example.test/path', 'link', 'm4-navigation-v1', 2)$$,
  '23514', null, 'v2 rejects URL-shaped domain data'
);
select throws_ok(
  $$insert into public.browser_events (
      user_id, device_id, session_id, client_event_id, client_event_uuid,
      sequence_number, event_kind, occurred_at, page_domain,
      capture_policy_version, event_contract_version
    ) values (
      '00000000-0000-4000-8000-0000000000b2', '10000000-0000-4000-8000-0000000000b2',
      '30000000-0000-4000-8000-0000000000b2', '46666666-6666-4666-8666-666666666666',
      '46666666-6666-4666-8666-666666666666', 2, 'navigation', now(),
      'example.test', 'm4-navigation-v1', 2)$$,
  '23514', null, 'v2 requires transition type'
);
select throws_ok(
  $$insert into public.browser_events (
      user_id, device_id, session_id, client_event_id, client_event_uuid,
      sequence_number, event_kind, occurred_at, page_domain, transition_type,
      capture_policy_version, event_contract_version
    ) values (
      '00000000-0000-4000-8000-0000000000b2', '10000000-0000-4000-8000-0000000000b2',
      '30000000-0000-4000-8000-0000000000b2', '47777777-7777-4777-8777-777777777777',
      '47777777-7777-4777-8777-777777777777', 2, 'navigation', now(),
      'example.test', 'auto_subframe', 'm4-navigation-v1', 2)$$,
  '23514', null, 'v2 rejects auto_subframe transition'
);
select throws_ok(
  $$insert into public.browser_events (
      user_id, device_id, session_id, client_event_id, client_event_uuid,
      sequence_number, event_kind, occurred_at, page_domain, transition_type,
      capture_policy_version, event_contract_version
    ) values (
      '00000000-0000-4000-8000-0000000000b2', '10000000-0000-4000-8000-0000000000b2',
      '30000000-0000-4000-8000-0000000000b2', '48888888-8888-4888-8888-888888888888',
      '48888888-8888-4888-8888-888888888888', 2, 'navigation', now(),
      'example.test', 'manual_subframe', 'm4-navigation-v1', 2)$$,
  '23514', null, 'v2 rejects manual_subframe transition'
);
select throws_ok(
  $$insert into public.browser_events (
      user_id, device_id, session_id, client_event_id, client_event_uuid,
      sequence_number, event_kind, occurred_at, page_domain, transition_type,
      capture_policy_version, event_contract_version
    ) values (
      '00000000-0000-4000-8000-0000000000b2', '10000000-0000-4000-8000-0000000000b2',
      '30000000-0000-4000-8000-0000000000b2', '49999999-9999-4999-8999-999999999999',
      '49999999-9999-4999-8999-999999999998', 2, 'navigation', now(),
      'example.test', 'reload', 'm4-navigation-v1', 2)$$,
  '23514', null, 'v2 requires the UUID text mirror to match'
);
select throws_ok(
  $$insert into public.browser_events (
      user_id, device_id, session_id, client_event_id, client_event_uuid,
      sequence_number, event_kind, occurred_at, page_domain, transition_type,
      capture_policy_version, event_contract_version
    ) values (
      '00000000-0000-4000-8000-0000000000b2', '10000000-0000-4000-8000-0000000000b2',
      '30000000-0000-4000-8000-0000000000b2', '4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 0, 'navigation', now(),
      'example.test', 'typed', 'm4-navigation-v1', 2)$$,
  '23514', null, 'v2 rejects sequence number zero'
);
select throws_ok(
  $$insert into public.browser_events (
      user_id, device_id, session_id, client_event_id, client_event_uuid,
      sequence_number, event_kind, occurred_at, page_domain, transition_type,
      capture_policy_version, event_contract_version
    ) values (
      '00000000-0000-4000-8000-0000000000b2', '10000000-0000-4000-8000-0000000000b2',
      '30000000-0000-4000-8000-0000000000b2', '4bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      '4bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', -1, 'navigation', now(),
      'example.test', 'typed', 'm4-navigation-v1', 2)$$,
  '23514', null, 'v2 rejects negative sequence numbers'
);

create temporary table m4_ingest_results (
  case_name text primary key,
  outcome text,
  response_status integer,
  accepted_count integer,
  duplicate_count integer
);

insert into m4_ingest_results
select 'created', result.* from public.ingest_browser_event_batch(
  '00000000-0000-4000-8000-0000000000a1', '/api/v1/events/batch',
  '10000000-0000-4000-8000-0000000000a1', '30000000-0000-4000-8000-0000000000a1',
  jsonb_build_array(jsonb_build_object(
    'client_event_id', '51111111-1111-4111-8111-111111111111',
    'sequence_number', 1,
    'event_kind', 'navigation',
    'occurred_at', to_jsonb(now() - interval '5 seconds'),
    'page_domain', 'example.test',
    'transition_type', 'link',
    'capture_policy_version', 'm4-navigation-v1',
    'event_fingerprint', repeat('a', 64)
  )),
  'm4-created-key', repeat('1', 64)
) as result;
select is((select outcome from m4_ingest_results where case_name = 'created'), 'created', 'valid v2 batch is created');
select is((select accepted_count from m4_ingest_results where case_name = 'created'), 1, 'valid v2 batch accepts one event');
select is(
  (select event_contract_version from public.browser_events
   where client_event_uuid = '51111111-1111-4111-8111-111111111111'),
  2::smallint,
  'RPC persists contract version 2'
);
select is(
  (select concat_ws(',', page_origin, page_path_hash, page_title_redacted,
                    accessibility_context_redacted, context_sha256)
   from public.browser_events
   where client_event_uuid = '51111111-1111-4111-8111-111111111111'),
  '',
  'RPC persists no v1 content fields for v2'
);
select is(
  (select contract_version from public.event_outbox
   where browser_event_id = (
     select id from public.browser_events
     where client_event_uuid = '51111111-1111-4111-8111-111111111111'
   )),
  2,
  'RPC creates version-2 outbox row transactionally'
);
select is(
  (select status::text from public.api_idempotency_records
   where user_id = '00000000-0000-4000-8000-0000000000a1'
     and idempotency_key = 'm4-created-key'),
  'completed',
  'RPC completes idempotency in the event transaction'
);

insert into m4_ingest_results
select 'replay', result.* from public.ingest_browser_event_batch(
  '00000000-0000-4000-8000-0000000000a1', '/api/v1/events/batch',
  '10000000-0000-4000-8000-0000000000a1', '30000000-0000-4000-8000-0000000000a1',
  '[]'::jsonb, 'm4-created-key', repeat('1', 64)
) as result;
select is((select outcome from m4_ingest_results where case_name = 'replay'), 'completed', 'exact request replay returns completed');
select is(
  (select outcome from public.ingest_browser_event_batch(
    '00000000-0000-4000-8000-0000000000a1', '/api/v1/events/batch',
    '10000000-0000-4000-8000-0000000000a1', '30000000-0000-4000-8000-0000000000a1',
    '[]'::jsonb, 'm4-created-key', repeat('2', 64)
  )),
  'conflict',
  'changed request hash conflicts before body validation'
);

insert into m4_ingest_results
select 'duplicate', result.* from public.ingest_browser_event_batch(
  '00000000-0000-4000-8000-0000000000a1', '/api/v1/events/batch',
  '10000000-0000-4000-8000-0000000000a1', '30000000-0000-4000-8000-0000000000a1',
  jsonb_build_array(jsonb_build_object(
    'client_event_id', '51111111-1111-4111-8111-111111111111',
    'sequence_number', 1, 'event_kind', 'navigation',
    'occurred_at', to_jsonb((select occurred_at from public.browser_events
                            where client_event_uuid = '51111111-1111-4111-8111-111111111111')),
    'page_domain', 'example.test', 'transition_type', 'link',
    'capture_policy_version', 'm4-navigation-v1',
    'event_fingerprint', repeat('a', 64)
  )),
  'm4-duplicate-key', repeat('3', 64)
) as result;
select is((select duplicate_count from m4_ingest_results where case_name = 'duplicate'), 1, 'same UUID identity is duplicate-safe');

select throws_ok(
  $$select * from public.ingest_browser_event_batch(
    '00000000-0000-4000-8000-0000000000a1', '/api/v1/events/batch',
    '10000000-0000-4000-8000-0000000000a1', '30000000-0000-4000-8000-0000000000a1',
    jsonb_build_array(jsonb_build_object(
      'client_event_id', '51111111-1111-4111-8111-111111111111',
      'sequence_number', 1, 'event_kind', 'navigation',
      'occurred_at', to_jsonb(now() - interval '5 seconds'),
      'page_domain', 'changed.example', 'transition_type', 'link',
      'capture_policy_version', 'm4-navigation-v1',
      'event_fingerprint', repeat('f', 64)
    )), 'm4-identity-conflict-key', repeat('4', 64)
  )$$,
  '23505', 'event identifier reused with different content',
  'same UUID with changed content conflicts'
);
select is(
  (select count(*) from public.api_idempotency_records
   where idempotency_key = 'm4-identity-conflict-key'),
  0::bigint,
  'identity conflict rolls back its idempotency claim'
);

select throws_ok(
  $$select * from public.ingest_browser_event_batch(
    '00000000-0000-4000-8000-0000000000a1', '/api/v1/events/batch',
    '10000000-0000-4000-8000-0000000000a1', '30000000-0000-4000-8000-0000000000a1',
    jsonb_build_array(jsonb_build_object(
      'client_event_id', '52222222-2222-4222-8222-222222222222',
      'sequence_number', 1, 'event_kind', 'navigation',
      'occurred_at', to_jsonb(now() - interval '4 seconds'),
      'page_domain', 'example.test', 'transition_type', 'link',
      'capture_policy_version', 'm4-navigation-v1',
      'event_fingerprint', repeat('2', 64)
    )), 'm4-sequence-conflict-key', repeat('5', 64)
  )$$,
  '23505', 'event sequence number already exists',
  'induced event insert failure aborts the batch'
);
select is(
  (select count(*) from public.api_idempotency_records
   where idempotency_key = 'm4-sequence-conflict-key'),
  0::bigint,
  'event insert failure rolls back idempotency claim'
);
select is(
  (select count(*) from public.event_outbox where contract_version = 2),
  1::bigint,
  'event insert failure creates no partial outbox row'
);

select is(
  (select outcome from public.ingest_browser_event_batch(
    '00000000-0000-4000-8000-0000000000d4', '/api/v1/events/batch',
    '10000000-0000-4000-8000-0000000000d4', '30000000-0000-4000-8000-0000000000d4',
    jsonb_build_array(jsonb_build_object(
      'client_event_id', '53333333-3333-4333-8333-333333333333',
      'sequence_number', 1, 'event_kind', 'navigation',
      'occurred_at', to_jsonb(now() - interval '3 seconds'),
      'page_domain', 'example.test', 'transition_type', 'typed',
      'capture_policy_version', 'm4-navigation-v1',
      'event_fingerprint', repeat('3', 64)
    )), 'm4-device-key', repeat('6', 64)
  )),
  'device_inactive',
  'revoked owner device returns typed inactive outcome'
);
select is(
  (select outcome from public.ingest_browser_event_batch(
    '00000000-0000-4000-8000-0000000000c3', '/api/v1/events/batch',
    '10000000-0000-4000-8000-0000000000c3', '30000000-0000-4000-8000-0000000000c3',
    jsonb_build_array(jsonb_build_object(
      'client_event_id', '54444444-4444-4444-8444-444444444444',
      'sequence_number', 1, 'event_kind', 'navigation',
      'occurred_at', to_jsonb(now() - interval '3 seconds'),
      'page_domain', 'example.test', 'transition_type', 'typed',
      'capture_policy_version', 'm4-navigation-v1',
      'event_fingerprint', repeat('4', 64)
    )), 'm4-consent-key', repeat('7', 64)
  )),
  'consent_inactive',
  'withdrawn consent returns typed inactive outcome'
);
select is(
  (select outcome from public.ingest_browser_event_batch(
    '00000000-0000-4000-8000-0000000000a1', '/api/v1/events/batch',
    '10000000-0000-4000-8000-0000000000a1', '30000000-0000-4000-8000-0000000000a2',
    jsonb_build_array(jsonb_build_object(
      'client_event_id', '55555555-5555-4555-8555-555555555555',
      'sequence_number', 1, 'event_kind', 'navigation',
      'occurred_at', to_jsonb(now() - interval '3 seconds'),
      'page_domain', 'example.test', 'transition_type', 'reload',
      'capture_policy_version', 'm4-navigation-v1',
      'event_fingerprint', repeat('5', 64)
    )), 'm4-session-key', repeat('8', 64)
  )),
  'session_not_recording',
  'paused session returns typed non-recording outcome'
);
select is(
  (select outcome from public.ingest_browser_event_batch(
    '00000000-0000-4000-8000-0000000000a1', '/api/v1/events/batch',
    '10000000-0000-4000-8000-0000000000a1', '30000000-0000-4000-8000-0000000000a3',
    jsonb_build_array(jsonb_build_object(
      'client_event_id', '56666666-6666-4666-8666-666666666666',
      'sequence_number', 1, 'event_kind', 'navigation',
      'occurred_at', to_jsonb(now() - interval '3 seconds'),
      'page_domain', 'example.test', 'transition_type', 'reload',
      'capture_policy_version', 'm4-navigation-v1',
      'event_fingerprint', repeat('6', 64)
    )), 'm4-completed-key', repeat('9', 64)
  )),
  'session_not_recording',
  'completed session accepts no later events'
);
select is(
  (select outcome from public.ingest_browser_event_batch(
    '00000000-0000-4000-8000-0000000000b2', '/api/v1/events/batch',
    '10000000-0000-4000-8000-0000000000a1', '30000000-0000-4000-8000-0000000000a1',
    jsonb_build_array(jsonb_build_object(
      'client_event_id', '57777777-7777-4777-8777-777777777777',
      'sequence_number', 2, 'event_kind', 'navigation',
      'occurred_at', to_jsonb(now() - interval '3 seconds'),
      'page_domain', 'example.test', 'transition_type', 'link',
      'capture_policy_version', 'm4-navigation-v1',
      'event_fingerprint', repeat('7', 64)
    )), 'm4-cross-owner-key', repeat('a', 64)
  )),
  'device_inactive',
  'cross-owner device and session are not exposed'
);
select is(
  (select outcome from public.ingest_browser_event_batch(
    '00000000-0000-4000-8000-0000000000a1', '/api/v1/events/batch',
    '10000000-0000-4000-8000-0000000000a1', '30000000-0000-4000-8000-0000000000a1',
    jsonb_build_array(jsonb_build_object(
      'client_event_id', '58888888-8888-4888-8888-888888888888',
      'sequence_number', 2, 'event_kind', 'navigation',
      'occurred_at', to_jsonb(now() - interval '3 seconds'),
      'page_domain', 'example.test', 'transition_type', 'link',
      'capture_policy_version', 'wrong-policy',
      'event_fingerprint', repeat('8', 64)
    )), 'm4-policy-key', repeat('b', 64)
  )),
  'policy_mismatch',
  'capture policy mismatch returns a typed outcome'
);
select is(
  (select count(*) from public.api_idempotency_records
   where idempotency_key in (
     'm4-device-key', 'm4-consent-key', 'm4-session-key', 'm4-completed-key',
     'm4-cross-owner-key', 'm4-policy-key'
   )),
  0::bigint,
  'typed authorization outcomes do not strand idempotency claims'
);

select throws_ok(
  $$select * from public.ingest_browser_event_batch(
    '00000000-0000-4000-8000-0000000000a1', '/api/v1/events/batch',
    '10000000-0000-4000-8000-0000000000a1', '30000000-0000-4000-8000-0000000000a1',
    jsonb_build_array(jsonb_build_object(
      'client_event_id', '59999999-9999-4999-8999-999999999999',
      'sequence_number', 2, 'event_kind', 'navigation',
      'occurred_at', to_jsonb(now() - interval '3 seconds'),
      'page_domain', 'example.test', 'transition_type', 'link',
      'capture_policy_version', 'm4-navigation-v1',
      'event_fingerprint', repeat('9', 64),
      'page_origin', 'https://example.test'
    )), 'm4-prohibited-key', repeat('c', 64)
  )$$,
  '22023', 'invalid v2 event shape',
  'RPC rejects prohibited v1 content fields in v2 input'
);
select is(
  (select count(*) from public.api_idempotency_records
   where idempotency_key = 'm4-prohibited-key'),
  0::bigint,
  'invalid v2 shape rolls back idempotency claim'
);
select throws_ok(
  $$select * from public.ingest_browser_event_batch(
    '00000000-0000-4000-8000-0000000000a1', '/api/v1/events/batch',
    '10000000-0000-4000-8000-0000000000a1', '30000000-0000-4000-8000-0000000000a1',
    jsonb_build_array(jsonb_build_object(
      'client_event_id', 'not-a-uuid',
      'sequence_number', 2, 'event_kind', 'navigation',
      'occurred_at', to_jsonb(now() - interval '3 seconds'),
      'page_domain', 'example.test', 'transition_type', 'link',
      'capture_policy_version', 'm4-navigation-v1',
      'event_fingerprint', repeat('d', 64)
    )), 'm4-invalid-uuid-key', repeat('d', 64)
  )$$,
  '22023', 'invalid v2 client event UUID',
  'RPC rejects non-UUID client event identity'
);

create temporary table m4_publish_results as
select * from public.publish_event_outbox(50);
select is((select published_count from m4_publish_results), 1, 'bounded publisher publishes the v2 outbox row');
create temporary table m4_queue_messages as
select message from pgmq.read('event_processing', 30, 50)
where message->>'browser_event_id' = (
  select id::text from public.browser_events
  where client_event_uuid = '51111111-1111-4111-8111-111111111111'
);
select results_eq(
  $$select message from m4_queue_messages$$,
  $$values (jsonb_build_object(
    'browser_event_id', (
      select id from public.browser_events
      where client_event_uuid = '51111111-1111-4111-8111-111111111111'
    ),
    'contract_version', 2
  ))$$,
  'version-2 queue body contains only event UUID and contract version'
);
select is(
  (select count(*)
   from m4_queue_messages
   cross join lateral jsonb_object_keys(message) as queue_key),
  2::bigint,
  'queue body contains exactly two keys and no browser metadata'
);

select * from finish();
rollback;
