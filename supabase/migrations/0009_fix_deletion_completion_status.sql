create or replace function public.complete_deletion_request(
  p_deletion_request_id uuid,
  p_failure_code text default null
)
returns public.deletion_status
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  result_status public.deletion_status;
begin
  update public.deletion_requests
  set status = case
        when p_failure_code is null then 'completed'::public.deletion_status
        else 'failed'::public.deletion_status
      end,
      completed_at = timezone('utc', now()),
      failure_code = p_failure_code
  where id = p_deletion_request_id and status = 'claimed'
  returning status into result_status;
  if result_status is not null then
    return result_status;
  end if;

  select status into result_status
  from public.deletion_requests
  where id = p_deletion_request_id;
  if result_status is null then
    raise exception 'deletion request does not exist' using errcode = 'P0001';
  end if;
  return result_status;
end;
$$;

revoke execute on function public.complete_deletion_request(uuid, text) from public, anon, authenticated;
grant execute on function public.complete_deletion_request(uuid, text) to service_role;
