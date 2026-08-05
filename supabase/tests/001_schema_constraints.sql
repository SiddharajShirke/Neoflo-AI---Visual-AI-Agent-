begin;
set local search_path = extensions, public, auth, pg_catalog;
select plan(17);

select has_table('public', 'profiles', 'profiles exists');
select has_table('public', 'devices', 'devices exists');
select has_table('public', 'consent_records', 'consent records exists');
select has_table('public', 'monitoring_sessions', 'monitoring sessions exists');
select has_table('public', 'browser_events', 'browser events exists');
select has_table('public', 'screenshot_metadata', 'screenshot metadata exists');
select has_table('public', 'observations', 'observations exists');
select has_table('public', 'activities', 'activities exists');
select has_table('public', 'activity_event_links', 'activity event links exists');
select has_table('public', 'session_summaries', 'session summaries exists');
select has_table('public', 'domain_rules', 'domain rules exists');
select has_table('public', 'deletion_requests', 'deletion requests exists');
select has_table('public', 'observation_embeddings', 'observation embeddings exists');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'constraints-a@example.test', 'not-a-real-password', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'constraints-b@example.test', 'not-a-real-password', '{}'::jsonb, '{}'::jsonb, now(), now());

insert into public.devices (id, user_id, installation_id, status)
values
  ('10000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000c1', 'test-device-constraint-a', 'active'),
  ('10000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000c2', 'test-device-constraint-b', 'active');

insert into public.consent_records (id, user_id, device_id, scope, policy_version, granted)
values
  ('20000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-0000000000c1', 'monitoring', 'test-v1', true),
  ('20000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000c2', '10000000-0000-0000-0000-0000000000c2', 'monitoring', 'test-v1', true);

insert into public.monitoring_sessions (id, user_id, device_id, monitoring_consent_id, status, started_at, ended_at, capture_policy_version)
values ('30000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-0000000000c1', '20000000-0000-0000-0000-0000000000c1', 'stopped', now() - interval '1 minute', now(), 'test-v1');

insert into public.browser_events (id, user_id, device_id, session_id, client_event_id, event_kind, occurred_at, capture_policy_version)
values ('40000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-0000000000c1', '30000000-0000-0000-0000-0000000000c1', 'test-event-idempotency', 'navigation', now(), 'test-v1');

select throws_ok(
  $$insert into public.devices (user_id, installation_id) values ('00000000-0000-0000-0000-0000000000c1', 'short')$$,
  '23514',
  null,
  'device installation identifiers must meet the minimum length'
);
select throws_ok(
  $$insert into public.monitoring_sessions (user_id, device_id, monitoring_consent_id, status, started_at, capture_policy_version) values ('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-0000000000c1', '20000000-0000-0000-0000-0000000000c1', 'stopped', now(), 'test-v1')$$,
  '23514',
  null,
  'stopped sessions require an end time'
);
select throws_ok(
  $$insert into public.consent_records (user_id, device_id, scope, policy_version, granted) values ('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-0000000000c2', 'monitoring', 'test-v1', true)$$,
  '23503',
  null,
  'consent records cannot reference another users device'
);
select throws_ok(
  $$insert into public.browser_events (user_id, device_id, session_id, client_event_id, event_kind, occurred_at, capture_policy_version) values ('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-0000000000c1', '30000000-0000-0000-0000-0000000000c1', 'test-event-idempotency', 'navigation', now(), 'test-v1')$$,
  '23505',
  null,
  'browser events are idempotent per device client event identifier'
);

select * from finish();
rollback;
