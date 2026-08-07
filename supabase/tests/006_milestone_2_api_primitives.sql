begin;
set local search_path = extensions, public, auth, pg_catalog;
select plan(23);

select has_table('public', 'event_outbox', 'event outbox exists');
select has_table('public', 'api_idempotency_records', 'idempotency table exists');
select ok(not exists (
  select 1 from pg_enum where enumtypid = 'public.monitoring_session_status'::regtype and enumlabel = 'expired'
), 'expired is not silently retained as a lifecycle state');
select ok(exists (
  select 1 from pg_enum where enumtypid = 'public.monitoring_session_status'::regtype and enumlabel = 'recording'
), 'recording state exists');
select ok(has_function_privilege('service_role', 'public.publish_event_outbox(integer)', 'execute'),
  'service role may publish outbox references');
select ok(not has_function_privilege('authenticated', 'public.publish_event_outbox(integer)', 'execute'),
  'authenticated role cannot publish outbox');
select ok(not has_table_privilege('authenticated', 'public.event_outbox', 'select'),
  'authenticated role cannot read outbox');
select ok(
  (select 'search_path=pg_catalog' = any(coalesce(proconfig, array[]::text[]))
   from pg_proc
   where oid = 'public.publish_event_outbox(integer)'::regprocedure),
  'outbox function has a minimal pg_catalog-only search path'
);
select ok(
  (select prosecdef from pg_proc
   where oid = 'public.publish_event_outbox(integer)'::regprocedure),
  'outbox function remains security definer'
);
select is(
  (select pg_get_userbyid(proowner) from pg_proc
   where oid = 'public.publish_event_outbox(integer)'::regprocedure),
  'postgres',
  'outbox function remains owned by postgres'
);
select ok(not has_function_privilege('anon', 'public.publish_event_outbox(integer)', 'execute'),
  'anonymous users cannot publish outbox');
select ok((select count(*) from public.monitoring_sessions where status::text = 'expired') = 0,
  'clean disposable migration contains no expired sessions');

select ok(
  position(
    'recording' in (
      select pg_get_expr(adbin, adrelid)
      from pg_attrdef
      where adrelid = 'public.monitoring_sessions'::regclass
        and adnum = (
          select attnum from pg_attribute
          where attrelid = 'public.monitoring_sessions'::regclass and attname = 'status'
        )
    )
  ) > 0,
  'monitoring session status default is recording'
);
select is(
  (select string_agg(enumlabel, ',' order by enumlabel)
   from pg_enum where enumtypid = 'public.monitoring_session_status'::regtype),
  'cancelled,completed,paused,recording',
  'final lifecycle enum has only approved states'
);
select ok(has_function_privilege(
  'service_role',
  'public.ingest_browser_event_batch(uuid, text, uuid, uuid, jsonb, text, text)',
  'execute'
), 'service role may ingest an idempotent event batch');
select ok(not has_function_privilege(
  'authenticated',
  'public.ingest_browser_event_batch(uuid, text, uuid, uuid, jsonb, text, text)',
  'execute'
), 'authenticated users cannot invoke the ingestion RPC');
select ok(not has_table_privilege('anon', 'public.api_idempotency_records', 'select'),
  'anonymous users cannot read idempotency records');
select ok(not has_table_privilege('authenticated', 'public.api_idempotency_records', 'select'),
  'authenticated users cannot read idempotency records');
select is(
  (select count(*)::integer from information_schema.columns
   where table_schema = 'public' and table_name = 'api_idempotency_records'
     and column_name in ('request_body', 'raw_request_body')),
  0,
  'idempotency records do not retain raw request bodies'
);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'lifecycle@example.test', 'not-a-real-password', '{}'::jsonb, '{}'::jsonb, now(), now());
insert into public.devices (id, user_id, installation_id, status)
values ('10000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f1', 'test-lifecycle-device', 'active');
insert into public.consent_records (id, user_id, device_id, scope, policy_version, granted)
values ('20000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f1', '10000000-0000-0000-0000-0000000000f1', 'monitoring', 'test-v1', true);
insert into public.monitoring_sessions (id, user_id, device_id, monitoring_consent_id, started_at, capture_policy_version)
values ('30000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f1', '10000000-0000-0000-0000-0000000000f1', '20000000-0000-0000-0000-0000000000f1', now(), 'test-v1');

select is(public.transition_monitoring_session(
  '30000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f1', 'paused'
)::text, 'paused', 'recording may transition to paused');
select is(public.transition_monitoring_session(
  '30000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f1', 'recording'
)::text, 'recording', 'paused may transition to recording');
select is(public.transition_monitoring_session(
  '30000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f1', 'completed'
)::text, 'completed', 'recording may transition to completed');
select throws_ok(
  $$select public.transition_monitoring_session('30000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f1', 'paused')$$,
  'P0001',
  'invalid session transition',
  'completed sessions cannot transition again'
);

select * from finish();
rollback;
