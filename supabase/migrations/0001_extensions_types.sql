create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists vector with schema extensions;
create extension if not exists pgmq;

create type public.device_status as enum ('active', 'revoked');
create type public.consent_scope as enum ('monitoring', 'screenshots', 'privacy_notice', 'retention');
create type public.monitoring_session_status as enum ('active', 'paused', 'stopped', 'expired');
create type public.browser_event_kind as enum ('navigation', 'meaningful_action', 'visibility_change');
create type public.screenshot_status as enum ('pending', 'uploaded', 'deleted');
create type public.observation_kind as enum ('classification', 'activity_signal', 'safety_signal');
create type public.activity_status as enum ('open', 'finalized');
create type public.activity_event_relation as enum ('primary', 'supporting');
create type public.domain_rule_source as enum ('system', 'user');
create type public.domain_rule_action as enum ('block', 'sensitive');
create type public.deletion_scope as enum ('account', 'session');
create type public.deletion_reason as enum ('user', 'retention');
create type public.deletion_status as enum ('requested', 'claimed', 'completed', 'failed');

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;
