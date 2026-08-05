create extension if not exists pgtap with schema extensions;

begin;
set local search_path = extensions, public, auth, pg_catalog;
select plan(1);
select ok(true, 'pgTAP test setup is available');
select * from finish();
rollback;
