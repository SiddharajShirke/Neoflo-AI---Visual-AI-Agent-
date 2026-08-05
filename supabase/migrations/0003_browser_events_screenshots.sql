create table public.browser_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  device_id uuid not null,
  session_id uuid not null,
  client_event_id text not null check (char_length(client_event_id) between 1 and 128),
  event_kind public.browser_event_kind not null,
  occurred_at timestamptz not null,
  received_at timestamptz not null default timezone('utc', now()),
  page_origin text check (page_origin ~ '^https?://[^/?#]+$'),
  page_path_hash text check (page_path_hash ~ '^[A-Fa-f0-9]{64}$'),
  page_title_redacted text check (char_length(page_title_redacted) <= 512),
  accessibility_context_redacted text check (char_length(accessibility_context_redacted) <= 12000),
  context_sha256 text check (context_sha256 ~ '^[A-Fa-f0-9]{64}$'),
  capture_policy_version text not null check (char_length(capture_policy_version) between 1 and 64),
  created_at timestamptz not null default timezone('utc', now()),
  unique (id, user_id),
  unique (device_id, client_event_id),
  foreign key (device_id, user_id) references public.devices(id, user_id) on delete restrict,
  foreign key (session_id, user_id) references public.monitoring_sessions(id, user_id) on delete cascade,
  check (received_at >= occurred_at)
);

create table public.screenshot_metadata (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  session_id uuid not null,
  source_event_id uuid not null,
  storage_path text not null unique check (storage_path like user_id::text || '/%'),
  content_type text not null check (content_type in ('image/jpeg', 'image/png', 'image/webp')),
  byte_size integer not null check (byte_size > 0 and byte_size <= 10485760),
  width integer not null check (width > 0 and width <= 10000),
  height integer not null check (height > 0 and height <= 10000),
  sha256 text not null check (sha256 ~ '^[A-Fa-f0-9]{64}$'),
  redaction_version text not null check (char_length(redaction_version) between 1 and 64),
  status public.screenshot_status not null default 'pending',
  captured_at timestamptz not null,
  uploaded_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  unique (id, user_id),
  foreign key (session_id, user_id) references public.monitoring_sessions(id, user_id) on delete cascade,
  foreign key (source_event_id, user_id) references public.browser_events(id, user_id) on delete cascade,
  check ((status = 'pending' and uploaded_at is null and deleted_at is null) or (status = 'uploaded' and uploaded_at is not null and deleted_at is null) or (status = 'deleted' and deleted_at is not null)),
  check (uploaded_at is null or uploaded_at >= captured_at),
  check (deleted_at is null or deleted_at >= captured_at)
);

create index browser_events_session_occurred_at_idx on public.browser_events(session_id, occurred_at);
create index browser_events_user_occurred_at_idx on public.browser_events(user_id, occurred_at desc);
create index screenshot_metadata_event_idx on public.screenshot_metadata(source_event_id);
create index screenshot_metadata_user_captured_at_idx on public.screenshot_metadata(user_id, captured_at desc);
