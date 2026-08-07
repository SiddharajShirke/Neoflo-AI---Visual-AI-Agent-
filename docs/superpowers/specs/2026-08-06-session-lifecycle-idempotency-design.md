# Session lifecycle and event-ingestion idempotency design

## Goal

Repair the unreleased session-lifecycle migration and make `POST /api/v1/events/batch` transactionally idempotent without retaining raw browser request data.

## Scope and constraints

- Directly repair unreleased migration `0010_session_lifecycle.sql`; do not alter Milestone 1 migrations and do not use `CASCADE`.
- The API derives the owner exclusively from the verified JWT subject. Database records never accept a client-supplied user identity.
- Each request is identified by owner, route, external idempotency key, and a canonical SHA-256 request hash.
- No raw request body, browser title, redacted context, private URL data, or raw idempotency key is written to application logs.
- The database stores only the required idempotency key, route, request hash, lifecycle status, and safe response metadata.
- Clean reset and disposable integration verification require a Docker-backed local Supabase stack. They are blocked in the current environment and must remain reported as such.
- No commit, merge, push, staging, or production database mutation is in scope.

## Lifecycle migration

`0010_session_lifecycle.sql` remains atomic. It first records non-sensitive counts of legacy state values and aborts if `expired` or any unknown value exists. It removes every status-dependent check and the old column default before the type conversion. The conversion has an explicit `USING` expression and maps only `active` to `recording` and `stopped` to `completed`; it preserves `paused` and assigns no meaning to expired history.

After conversion, it replaces the enum with `recording`, `paused`, `completed`, and `cancelled`; creates the `recording` default; restores the lifecycle time check and index; installs owner-scoped allowed transitions; restores grants; and asserts that no legacy label remains. pgTAP tests cover clean schema shape, default, mappings, abort conditions, legacy-label absence, and valid/invalid transitions.

## Idempotency transaction

One `SECURITY DEFINER` RPC is the only persistence path for event ingestion. It accepts the server-derived owner, fixed route identifier, external key, canonical hash, and already validated event representation.

The idempotency table has one active record per owner and external key. Route and hash are stored on that row, allowing the function to distinguish a route mismatch or hash mismatch from an exact retry. A first caller creates the row in `in_progress` state and retains the row lock. A retry waits on that lock, then returns the saved response when completed; it receives a typed conflict if route or hash differs. A successful first caller validates owner-scoped device, recording session, and active monitoring consent; inserts browser events and matching outbox rows; writes only safe counts and response status; then marks the row completed. Database exceptions abort the entire function transaction, rolling back the claim, events, and outbox rows.

The RPC returns a typed result object rather than exposing database exception text. The API maps successful first calls and exact retries to the original `202` response, route/hash reuse to `409 idempotency_key_reused`, and a lock/in-progress outcome to a deterministic retryable response.

## API and repository boundary

`event_batch_request_hash` canonicalizes every persistence-affecting field with stable JSON object-key ordering. The route constant, verified owner, raw key, and hash are passed to `Repository.ingest`. `MemoryRepository` retains only enough safe state to reproduce completed, conflict, and retry behavior in unit tests. `PostgrestRepository` serializes event fingerprints and calls the database RPC; it does not issue a fallback insert sequence. Production repository selection remains fail-closed when the server-only Supabase configuration is absent.

## Testing and verification

Tests are written red-green-refactor. Unit tests cover canonical hashing, exact retry, reuse conflicts, route/owner isolation, missing keys, and key length. SQL tests cover lifecycle safety, RLS/privilege boundaries, rollback behavior, and no raw request-body storage. Disposable local Supabase integration tests cover row counts, retries, conflicts, failures, concurrency, and role access once Docker is available.

The full lint, typing, unit, format, build, secret-scan, migration-check, local reset, pgTAP, import, OpenAPI, and diff checks remain required before declaring readiness.
