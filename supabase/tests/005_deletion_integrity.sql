begin;
set local search_path = extensions, public, auth, pg_catalog;
select plan(11);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'delete@example.test', 'not-a-real-password', '{}'::jsonb, '{}'::jsonb, now(), now());

insert into public.devices (id, user_id, installation_id, status)
values ('10000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000d1', 'test-delete-device-0001', 'active');
insert into public.consent_records (id, user_id, device_id, scope, policy_version, granted)
values ('20000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000d1', '10000000-0000-0000-0000-0000000000d1', 'monitoring', 'test-v1', true);
insert into public.monitoring_sessions (id, user_id, device_id, monitoring_consent_id, status, started_at, ended_at, capture_policy_version)
values ('30000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000d1', '10000000-0000-0000-0000-0000000000d1', '20000000-0000-0000-0000-0000000000d1', 'stopped', now() - interval '1 minute', now(), 'test-v1');

insert into public.browser_events (id, user_id, device_id, session_id, client_event_id, event_kind, occurred_at, capture_policy_version)
values ('40000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000d1', '10000000-0000-0000-0000-0000000000d1', '30000000-0000-0000-0000-0000000000d1', 'test-delete-event', 'navigation', now(), 'test-v1');

insert into public.screenshot_metadata (id, user_id, session_id, source_event_id, storage_path, content_type, byte_size, width, height, sha256, redaction_version, status, captured_at, uploaded_at)
values ('60000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000d1', '30000000-0000-0000-0000-0000000000d1', '40000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000d1/test-delete.png', 'image/png', 1, 1, 1, repeat('d', 64), 'test-v1', 'uploaded', now(), now());

select throws_ok(
  $$insert into public.deletion_requests (user_id, scope, status) values ('00000000-0000-0000-0000-0000000000d1', 'session', 'requested')$$,
  '23514',
  null,
  'session deletion requires a session id'
);
select throws_ok(
  $$insert into public.deletion_requests (user_id, session_id, scope, status) values ('00000000-0000-0000-0000-0000000000d1', '30000000-0000-0000-0000-0000000000d1', 'account', 'requested')$$,
  '23514',
  null,
  'account deletion cannot carry a session id'
);

insert into public.deletion_requests (id, user_id, session_id, scope, status)
values ('50000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000d1', '30000000-0000-0000-0000-0000000000d1', 'session', 'requested');

select is(public.claim_deletion_request('50000000-0000-0000-0000-0000000000d1')::text, 'claimed', 'claim transitions requested deletion');
select is(public.claim_deletion_request('50000000-0000-0000-0000-0000000000d1')::text, 'claimed', 'claim is idempotent');
select is(public.complete_deletion_request('50000000-0000-0000-0000-0000000000d1', null)::text, 'completed', 'complete transitions claimed deletion');
select is(public.complete_deletion_request('50000000-0000-0000-0000-0000000000d1', null)::text, 'completed', 'complete is idempotent');
select is(
  (select count(*) from public.deletion_requests where id = '50000000-0000-0000-0000-0000000000d1' and completed_at is not null),
  1::bigint,
  'completed deletion records completion time'
);
delete from public.monitoring_sessions where id = '30000000-0000-0000-0000-0000000000d1';
select is((select count(*) from public.browser_events where id = '40000000-0000-0000-0000-0000000000d1'), 0::bigint, 'session deletion cascades to browser events');
select is((select count(*) from public.screenshot_metadata where id = '60000000-0000-0000-0000-0000000000d1'), 0::bigint, 'session deletion cascades to screenshot metadata');
select is((select count(*) from public.deletion_requests where id = '50000000-0000-0000-0000-0000000000d1'), 0::bigint, 'session deletion cascades to deletion requests');
select ok(to_regclass('cron.job') is null, 'no production retention schedule is enabled');

select * from finish();
rollback;
