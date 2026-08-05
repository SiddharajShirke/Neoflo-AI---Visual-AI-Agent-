create table public.observations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  session_id uuid not null,
  source_event_id uuid not null,
  kind public.observation_kind not null,
  content_redacted text not null check (char_length(content_redacted) <= 12000),
  confidence numeric(4, 3) check (confidence between 0 and 1),
  processing_version text not null check (char_length(processing_version) between 1 and 64),
  model_provider text check (char_length(model_provider) between 1 and 64),
  model_version text check (char_length(model_version) between 1 and 128),
  prompt_version text check (char_length(prompt_version) between 1 and 64),
  created_at timestamptz not null default timezone('utc', now()),
  unique (id, user_id),
  unique (source_event_id, kind, processing_version),
  foreign key (session_id, user_id) references public.monitoring_sessions(id, user_id) on delete cascade,
  foreign key (source_event_id, user_id) references public.browser_events(id, user_id) on delete cascade
);

create table public.activities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  session_id uuid not null,
  status public.activity_status not null default 'open',
  category text check (char_length(category) between 1 and 80),
  title_redacted text not null check (char_length(title_redacted) between 1 and 512),
  summary_redacted text check (char_length(summary_redacted) <= 12000),
  started_at timestamptz not null,
  ended_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (id, user_id),
  foreign key (session_id, user_id) references public.monitoring_sessions(id, user_id) on delete cascade,
  check (ended_at is null or ended_at >= started_at)
);

create table public.activity_event_links (
  user_id uuid not null references public.profiles(id) on delete cascade,
  activity_id uuid not null,
  source_event_id uuid not null,
  relation public.activity_event_relation not null,
  ordinal integer not null default 0 check (ordinal >= 0),
  created_at timestamptz not null default timezone('utc', now()),
  primary key (activity_id, source_event_id),
  foreign key (activity_id, user_id) references public.activities(id, user_id) on delete cascade,
  foreign key (source_event_id, user_id) references public.browser_events(id, user_id) on delete cascade
);

create table public.session_summaries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  session_id uuid not null,
  summary_version text not null check (char_length(summary_version) between 1 and 64),
  summary_redacted text not null check (char_length(summary_redacted) <= 12000),
  first_event_at timestamptz,
  last_event_at timestamptz,
  source_event_count integer not null default 0 check (source_event_count >= 0),
  created_at timestamptz not null default timezone('utc', now()),
  unique (id, user_id),
  unique (session_id, summary_version),
  foreign key (session_id, user_id) references public.monitoring_sessions(id, user_id) on delete cascade,
  check (last_event_at is null or first_event_at is null or last_event_at >= first_event_at)
);

create table public.observation_embeddings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  observation_id uuid not null,
  embedding extensions.vector not null,
  embedding_model text not null check (char_length(embedding_model) between 1 and 128),
  embedding_dimensions integer not null check (embedding_dimensions > 0 and embedding_dimensions <= 2000),
  created_at timestamptz not null default timezone('utc', now()),
  unique (observation_id, embedding_model),
  foreign key (observation_id, user_id) references public.observations(id, user_id) on delete cascade,
  check (extensions.vector_dims(embedding) = embedding_dimensions)
);

create index observations_event_created_at_idx on public.observations(source_event_id, created_at);
create index observations_session_created_at_idx on public.observations(session_id, created_at);
create index activities_session_started_at_idx on public.activities(session_id, started_at);
create index activities_user_started_at_idx on public.activities(user_id, started_at desc);
create index activity_event_links_event_idx on public.activity_event_links(source_event_id);
create index session_summaries_session_version_idx on public.session_summaries(session_id, summary_version desc);
