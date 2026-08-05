begin;
set local search_path = extensions, public, storage, auth, pg_catalog;
select plan(6);

select is(
  (select public from storage.buckets where id = 'redacted-screenshots'),
  false,
  'redacted screenshot bucket is private'
);
select is(
  (select file_size_limit from storage.buckets where id = 'redacted-screenshots'),
  10485760::bigint,
  'bucket size limit is ten MiB'
);
select results_eq(
  $$select allowed_mime_types from storage.buckets where id = 'redacted-screenshots'$$,
  $$values (array['image/jpeg', 'image/png', 'image/webp']::text[])$$,
  'bucket only permits raster screenshot formats'
);
select is(
  (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'redacted_screenshots_select_own'),
  1::bigint,
  'owner read policy exists'
);
select is(
  (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'redacted_screenshots_%'),
  1::bigint,
  'no direct client upload, update, or delete policy exists'
);
insert into storage.objects (bucket_id, name)
values
  ('redacted-screenshots', '00000000-0000-0000-0000-0000000000a1/test-a.png'),
  ('redacted-screenshots', '00000000-0000-0000-0000-0000000000b2/test-b.png');

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
select results_eq(
  $$select name from storage.objects where bucket_id = 'redacted-screenshots' order by name$$,
  $$values ('00000000-0000-0000-0000-0000000000a1/test-a.png'::text)$$,
  'user A can select only the screenshot object under their owner path'
);
reset role;

select * from finish();
rollback;
