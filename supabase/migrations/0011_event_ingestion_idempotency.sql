alter table public.browser_events
  add column sequence_number bigint not null default 0 check (sequence_number >= 0),
  add column event_fingerprint text check (event_fingerprint ~ '^[A-Fa-f0-9]{64}$');

create unique index browser_events_session_sequence_idx
  on public.browser_events(session_id, sequence_number);
create index browser_events_device_client_event_idx
  on public.browser_events(device_id, client_event_id);

create type public.api_idempotency_status as enum ('in_progress', 'completed');

create table public.api_idempotency_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  route text not null check (route ~ '^/api/v1/'),
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 128),
  request_sha256 text not null check (request_sha256 ~ '^[A-Fa-f0-9]{64}$'),
  status public.api_idempotency_status not null default 'in_progress',
  response_status integer check (response_status between 200 and 299),
  response_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  expires_at timestamptz not null default timezone('utc', now()) + interval '7 days',
  unique (user_id, idempotency_key),
  check ((status = 'in_progress' and response_status is null and response_metadata = '{}'::jsonb)
      or (status = 'completed' and response_status is not null)),
  check (expires_at > created_at)
);
create index api_idempotency_records_expires_at_idx on public.api_idempotency_records(expires_at);

-- Retention is candidate metadata only; scheduling/deletion is deliberately deferred.
comment on table public.api_idempotency_records is
  'Seven-day retry metadata. Stores request hashes and safe response metadata, never browser bodies.';
