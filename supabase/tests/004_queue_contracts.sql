begin;
set local search_path = extensions, public, pgmq, auth, pg_catalog;
select plan(9);

select has_extension('pgmq', 'PGMQ is enabled');
select ok(to_regclass('pgmq.q_event_processing') is not null, 'event processing queue exists');
select ok(to_regclass('pgmq.q_deletion_processing') is not null, 'deletion processing queue exists');
select ok(
  has_function_privilege('service_role', 'public.enqueue_event_processing(uuid)', 'execute'),
  'event enqueue is executable by the service role'
);
select ok(
  has_function_privilege('service_role', 'public.enqueue_deletion_processing(uuid)', 'execute'),
  'deletion enqueue is executable by the service role'
);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'queue@example.test', 'not-a-real-password', '{}'::jsonb, '{}'::jsonb, now(), now());
insert into public.devices (id, user_id, installation_id, status)
values ('10000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e1', 'test-queue-device-0001', 'active');
insert into public.consent_records (id, user_id, device_id, scope, policy_version, granted)
values ('20000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e1', '10000000-0000-0000-0000-0000000000e1', 'monitoring', 'test-v1', true);
insert into public.monitoring_sessions (id, user_id, device_id, monitoring_consent_id, status, started_at, ended_at, capture_policy_version)
values ('30000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e1', '10000000-0000-0000-0000-0000000000e1', '20000000-0000-0000-0000-0000000000e1', 'stopped', now() - interval '1 minute', now(), 'test-v1');
insert into public.browser_events (id, user_id, device_id, session_id, client_event_id, event_kind, occurred_at, capture_policy_version)
values ('40000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e1', '10000000-0000-0000-0000-0000000000e1', '30000000-0000-0000-0000-0000000000e1', 'test-queue-event', 'navigation', now(), 'test-v1');
insert into public.deletion_requests (id, user_id, session_id, scope, status)
values ('50000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e1', '30000000-0000-0000-0000-0000000000e1', 'session', 'requested');

create temporary table queue_message_ids (queue_name text primary key, message_id bigint not null);
insert into queue_message_ids values
  ('event_processing', public.enqueue_event_processing('40000000-0000-0000-0000-0000000000e1')),
  ('deletion_processing', public.enqueue_deletion_processing('50000000-0000-0000-0000-0000000000e1'));

select results_eq(
  $$select message from pgmq.read('event_processing', 30, 1) where msg_id = (select message_id from queue_message_ids where queue_name = 'event_processing')$$,
  $$values ('{"browser_event_id":"40000000-0000-0000-0000-0000000000e1","contract_version":1}'::jsonb)$$,
  'event queue messages contain only the event reference and contract version'
);
select results_eq(
  $$select message from pgmq.read('deletion_processing', 30, 1) where msg_id = (select message_id from queue_message_ids where queue_name = 'deletion_processing')$$,
  $$values ('{"deletion_request_id":"50000000-0000-0000-0000-0000000000e1","contract_version":1}'::jsonb)$$,
  'deletion queue messages contain only the deletion reference and contract version'
);
select throws_ok(
  $$select public.enqueue_event_processing('00000000-0000-0000-0000-000000000000')$$,
  'P0001',
  'browser event does not exist',
  'event queue helper rejects unknown references'
);
select throws_ok(
  $$select public.enqueue_deletion_processing('00000000-0000-0000-0000-000000000000')$$,
  'P0001',
  'deletion request does not exist',
  'deletion queue helper rejects unknown references'
);

select * from finish();
rollback;
