# Staging pgTAP cleanup safety record - 2026-08-06

## Scope

- Linked project reference: `mwqydsppvhlzuocplnjz`
- Project identity: active `Visual AI Agent` project; designated staging environment.
- This record contains no credentials, connection strings, user data, or Storage object names.

## Preflight evidence

- `pgtap` was installed normally as PostgreSQL extension version `1.3.3` in schema `extensions`.
- Aggregate-only checks returned zero `auth.users`, zero `storage.objects`, and zero estimated public-table rows.
- Local and remote migration history matched exactly: `0001` through `0009`.
- No repository migration references `pgtap`; the only extension declarations are `pgcrypto`, `vector`, and `pgmq`.
- No application function had a dependency on a pgTAP object.
- No orphan/manual pgTAP helper was found in `extensions`.

## Objects approved for removal

Remove only the registered `pgtap` extension, without `CASCADE`:

```sql
drop extension if exists pgtap;
```

At preflight, its extension membership contained exactly 1,079 function objects, two pgTAP views (`pg_all_foreign_keys`, `tap_funky`), and six pgTAP type objects (including their array types). The only reverse dependencies found were the extension's own internal composite types and view rules. No application schema, table, queue, Storage bucket, policy, application function, or migration object was a removal target.

## Lint failure before cleanup

Cloud `db lint --linked --fail-on error` failed only while linting pgTAP functions in `extensions`, including unresolved pgTAP internal references such as `__tcache__` and `plan(integer)`. This test-only installation is not part of Milestone 1 migrations.

## Cleanup result

`drop extension if exists pgtap;` completed without `CASCADE`. Follow-up checks found no pgTAP extension or `plan`, `finish`, `ok`, or `__tcache__` function in `extensions`. Cloud lint passed, migration parity remained `0001` through `0009`, and cloud dry run reported no pending change.
