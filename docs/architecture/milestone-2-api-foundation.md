# Milestone 2 API foundation

FastAPI is the authenticated boundary for browser and dashboard clients. Browser
JWTs are verified against Supabase JWKS using issuer, audience, expiry, and
subject checks. The verified subject is the only source of user identity.

Client routes are mounted below `/api/v1`; health stays public at
`/health/live` and `/health/ready`. CORS admits only configured origins and is
not applied to the server-only internal outbox publisher. The internal endpoint
is disabled unless its independent credential is configured and uses a
constant-time comparison.

The API accepts only strict redacted browser-event contracts. It does not
accept raw URLs, DOM/HTML, cookies, credentials, clipboard content, screenshots,
or user IDs. Event rows are idempotent by device/client event identity; request
retries use hashes and safe response metadata with a seven-day candidate
retention period.

Event persistence and outbox creation must occur in one PostgreSQL transaction.
`public.publish_event_outbox` locks pending rows, enqueues only
`browser_event_id` and contract version in PGMQ, and records publication in the
same transaction. It is service-role-only. Queue consumption and processing are
not included in this milestone.

Session deletion is asynchronous: a terminal, owner-scoped session receives an
idempotent `deletion_requests` record and a `202 Accepted` response. The route
does not delete relational data or screenshot objects, and it does not claim
completion. Storage deletion orchestration remains deferred.
