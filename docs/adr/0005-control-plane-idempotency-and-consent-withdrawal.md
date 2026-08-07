# ADR 0005: Make extension control-plane mutations transactional and replay-safe

## Status

Accepted for Milestone 3.

## Decision

Require an `Idempotency-Key` for extension-facing consent creation, monitoring
session creation, and each fixed session lifecycle transition. FastAPI derives
the authenticated owner from the verified Supabase JWT, hashes the canonical
public request without retaining its body, and invokes service-role-only
Supabase RPCs. Each RPC atomically claims the owner/key/route/hash record,
performs the mutation, and retains only safe response metadata for seven days.

Consent records remain append-only audit evidence apart from setting
`revoked_at` on the formerly active grant. A new grant or a withdrawal revokes
the active grant for exactly the same user, device, and scope before appending
the next record. A partial unique index guarantees there is at most one active
grant in that scope.

## Consequences

Timeout-after-commit retries receive the original safe response. Changed
requests or different routes using the same owner key receive a conflict.
Withdrawn or superseded consent IDs cannot create later sessions. No client
receives a Supabase service key, idempotency records retain no request body,
and direct database access remains unavailable to authenticated clients.

Rollback, if needed, is a separately reviewed forward-only migration; this
migration is not edited after application.
