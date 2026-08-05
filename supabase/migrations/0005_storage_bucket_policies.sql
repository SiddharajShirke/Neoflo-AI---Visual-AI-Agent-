insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'redacted-screenshots',
  'redacted-screenshots',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy redacted_screenshots_select_own
on storage.objects
for select
to authenticated
using (
  bucket_id = 'redacted-screenshots'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

comment on policy redacted_screenshots_select_own on storage.objects is
  'Private read access only. Future FastAPI routes generate short-lived signed URLs; clients never upload directly.';
