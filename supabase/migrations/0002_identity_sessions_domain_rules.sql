create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text check (char_length(display_name) between 1 and 120),
  timezone text not null default 'UTC' check (char_length(timezone) between 1 and 64),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id)
  values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_auth_user();

create table public.devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  installation_id text not null check (char_length(installation_id) between 16 and 255),
  label text check (char_length(label) between 1 and 120),
  client_version text check (char_length(client_version) between 1 and 64),
  status public.device_status not null default 'active',
  last_seen_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (id, user_id),
  unique (user_id, installation_id)
);

create table public.consent_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  device_id uuid not null,
  scope public.consent_scope not null,
  policy_version text not null check (char_length(policy_version) between 1 and 64),
  granted boolean not null,
  recorded_at timestamptz not null default timezone('utc', now()),
  revoked_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  unique (id, user_id),
  foreign key (device_id, user_id) references public.devices(id, user_id) on delete cascade,
  check (revoked_at is null or revoked_at >= recorded_at)
);

create table public.monitoring_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  device_id uuid not null,
  monitoring_consent_id uuid not null,
  screenshot_consent_id uuid,
  status public.monitoring_session_status not null default 'active',
  started_at timestamptz not null,
  ended_at timestamptz,
  capture_policy_version text not null check (char_length(capture_policy_version) between 1 and 64),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (id, user_id),
  foreign key (device_id, user_id) references public.devices(id, user_id) on delete restrict,
  foreign key (monitoring_consent_id, user_id) references public.consent_records(id, user_id) on delete restrict,
  foreign key (screenshot_consent_id, user_id) references public.consent_records(id, user_id) on delete restrict,
  check ((ended_at is null and status in ('active', 'paused')) or (ended_at is not null and status in ('stopped', 'expired'))),
  check (ended_at is null or ended_at >= started_at)
);

create or replace function public.validate_session_consents()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.consent_records
    where id = new.monitoring_consent_id and user_id = new.user_id and scope = 'monitoring' and granted and revoked_at is null
  ) then
    raise exception 'monitoring consent must be active for this user' using errcode = '23514';
  end if;
  if new.screenshot_consent_id is not null and not exists (
    select 1 from public.consent_records
    where id = new.screenshot_consent_id and user_id = new.user_id and scope = 'screenshots' and granted and revoked_at is null
  ) then
    raise exception 'screenshot consent must be active for this user' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger monitoring_sessions_validate_consents
  before insert or update of monitoring_consent_id, screenshot_consent_id, user_id on public.monitoring_sessions
  for each row execute procedure public.validate_session_consents();

create table public.domain_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  source public.domain_rule_source not null,
  host text not null check (host = lower(host) and host !~ '[/:\\s]' and char_length(host) between 1 and 253),
  is_suffix_match boolean not null default false,
  action public.domain_rule_action not null,
  enabled boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check ((source = 'system' and user_id is null) or (source = 'user' and user_id is not null)),
  unique nulls not distinct (user_id, source, host, is_suffix_match, action)
);

create index devices_user_status_idx on public.devices(user_id, status);
create index consent_records_user_recorded_at_idx on public.consent_records(user_id, recorded_at desc);
create index monitoring_sessions_user_started_at_idx on public.monitoring_sessions(user_id, started_at desc);
create index domain_rules_user_enabled_idx on public.domain_rules(user_id, enabled) where source = 'user';

create trigger profiles_set_updated_at before update on public.profiles for each row execute procedure public.set_updated_at();
create trigger devices_set_updated_at before update on public.devices for each row execute procedure public.set_updated_at();
create trigger monitoring_sessions_set_updated_at before update on public.monitoring_sessions for each row execute procedure public.set_updated_at();
create trigger domain_rules_set_updated_at before update on public.domain_rules for each row execute procedure public.set_updated_at();
