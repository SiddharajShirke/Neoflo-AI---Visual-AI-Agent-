create or replace function public.list_retention_candidates(p_as_of timestamptz default timezone('utc', now()))
returns table (resource_type text, resource_id uuid, user_id uuid, delete_after timestamptz)
language sql
security definer
set search_path = public, pg_catalog
as $$
  select 'screenshot_metadata', id, user_id, captured_at + interval '7 days'
  from public.screenshot_metadata
  where status = 'uploaded' and captured_at + interval '7 days' <= p_as_of
  union all
  select 'browser_events', id, user_id, occurred_at + interval '30 days'
  from public.browser_events
  where occurred_at + interval '30 days' <= p_as_of
  union all
  select 'observations', id, user_id, created_at + interval '90 days'
  from public.observations
  where created_at + interval '90 days' <= p_as_of
  union all
  select 'activities', id, user_id, created_at + interval '90 days'
  from public.activities
  where created_at + interval '90 days' <= p_as_of
  union all
  select 'session_summaries', id, user_id, created_at + interval '180 days'
  from public.session_summaries
  where created_at + interval '180 days' <= p_as_of
  union all
  select 'deletion_requests', id, user_id, completed_at + interval '30 days'
  from public.deletion_requests
  where status in ('completed', 'failed') and completed_at + interval '30 days' <= p_as_of;
$$;

revoke execute on function public.list_retention_candidates(timestamptz) from public, anon, authenticated;
grant execute on function public.list_retention_candidates(timestamptz) to service_role;

comment on function public.list_retention_candidates(timestamptz) is
  'Returns candidates only. No pg_cron job or automatic deletion schedule is created in Milestone 1.';
