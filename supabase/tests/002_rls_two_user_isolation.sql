begin;
set local search_path = extensions, public, auth, pg_catalog;
select plan(12);

create temporary table test_users (id uuid primary key);
insert into test_users values ('00000000-0000-0000-0000-0000000000a1'), ('00000000-0000-0000-0000-0000000000b2');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', id::text || '@example.test', 'not-a-real-password', '{}'::jsonb, '{}'::jsonb, now(), now()
from test_users;

insert into public.devices (id, user_id, installation_id, status)
values
  ('10000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1', 'test-device-rls-user-a', 'active'),
  ('10000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000b2', 'test-device-rls-user-b', 'active');

insert into public.consent_records (id, user_id, device_id, scope, policy_version, granted)
values
  ('20000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000a1', 'monitoring', 'test-v1', true),
  ('20000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000b2', '10000000-0000-0000-0000-0000000000b2', 'monitoring', 'test-v1', true);

insert into public.monitoring_sessions (id, user_id, device_id, monitoring_consent_id, status, started_at, ended_at, capture_policy_version)
values
  ('30000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000a1', '20000000-0000-0000-0000-0000000000a1', 'completed', now() - interval '1 minute', now(), 'test-v1'),
  ('30000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000b2', '10000000-0000-0000-0000-0000000000b2', '20000000-0000-0000-0000-0000000000b2', 'completed', now() - interval '1 minute', now(), 'test-v1');

insert into public.browser_events (id, user_id, device_id, session_id, client_event_id, event_kind, occurred_at, capture_policy_version)
values
  ('40000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000a1', '30000000-0000-0000-0000-0000000000a1', 'event-a', 'navigation', now(), 'test-v1'),
  ('40000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000b2', '10000000-0000-0000-0000-0000000000b2', '30000000-0000-0000-0000-0000000000b2', 'event-b', 'navigation', now(), 'test-v1');

insert into public.screenshot_metadata (id, user_id, session_id, source_event_id, storage_path, content_type, byte_size, width, height, sha256, redaction_version, status, captured_at, uploaded_at)
values
  ('60000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1', '30000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1/test-a.png', 'image/png', 1, 1, 1, repeat('a', 64), 'test-v1', 'uploaded', now(), now()),
  ('60000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000b2', '30000000-0000-0000-0000-0000000000b2', '40000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000b2/test-b.png', 'image/png', 1, 1, 1, repeat('b', 64), 'test-v1', 'uploaded', now(), now());

insert into public.domain_rules (id, source, host, action)
values ('70000000-0000-0000-0000-0000000000a1', 'system', 'blocked.example', 'block');

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
select results_eq('select count(*)::integer from public.devices', array[1], 'user A sees one device');
select results_eq('select count(*)::integer from public.monitoring_sessions', array[1], 'user A sees one session');
select results_eq('select count(*)::integer from public.browser_events', array[1], 'user A sees one event');
select results_eq('select count(*)::integer from public.consent_records', array[1], 'user A sees one consent record');
select results_eq('select count(*)::integer from public.screenshot_metadata', array[1], 'user A sees only their screenshot metadata');
select results_eq('select count(*)::integer from public.observations', array[0], 'user A sees no other observations');
select results_eq('select count(*)::integer from public.deletion_requests', array[0], 'user A sees no other deletion requests');
select results_eq('select count(*)::integer from public.domain_rules', array[0], 'user A cannot read protected system domain rules');
select throws_ok(
  $$insert into public.domain_rules (source, host, action) values ('system', 'attacker.example', 'block')$$,
  '42501',
  null,
  'authenticated users cannot create system domain rules'
);
select throws_ok(
  $$update public.domain_rules set enabled = false where id = '70000000-0000-0000-0000-0000000000a1'$$,
  '42501',
  null,
  'authenticated users cannot modify system domain rules'
);
select throws_ok(
  $$delete from public.domain_rules where id = '70000000-0000-0000-0000-0000000000a1'$$,
  '42501',
  null,
  'authenticated users cannot delete system domain rules'
);
reset role;

select is(
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'browser_events' and policyname = 'browser_events_select_own'),
  1::bigint,
  'browser event owner policy exists'
);

select * from finish();
rollback;
