# ADR 0006: Navigation-only Browser Event v2 privacy boundary

## Status

Accepted for Milestone 4-A.

## Context

Browser Event v1 is a historical redacted contract that permits optional origin, path-hash, title, and accessibility-context fields. Milestone 4 captures only future top-level navigation metadata, so v1 cannot be reused as the future capture boundary.

## Decision

Keep v1 immutable. The existing event-batch endpoint accepts only Browser Event v2 for future capture. A v2 event contains an RFC 4122 client event UUID, a positive sequence number, literal `navigation` event kind, timestamp, normalized registrable `page_domain`, a top-level-useful transition type, and capture-policy version.

V2 prohibits URLs, origins, hosts, ports, paths, queries, fragments, titles, DOM/text/accessibility data, tab/document/process identifiers, and transition qualifiers. Database v2 rows retain only the domain and transition metadata while legacy content columns are NULL. A queue message contains only `browser_event_id` and `contract_version`.

The API derives ownership from JWT validation and returns safe typed state outcomes for inactive devices or consent, non-recording sessions, and policy mismatch. Event, outbox, and idempotency completion remain one transaction. FastAPI makes one bounded post-commit outbox attempt; publisher failure does not undo a committed ingestion response.

Repository search before this cutover found no extension or dashboard runtime event-batch caller: the only non-test implementation references were the FastAPI route and its repository call. No runtime client sends a v1 batch.

## Consequences

Future extension capture must construct v2 only and must not call the internal publisher. Existing v1 records and contract artifacts remain readable for historical compatibility but are not accepted through the M4 endpoint. Queue consumers remain deferred and must preserve the reference-only payload.

## Rollback

Do not alter migration `0017` or reinterpret v1 rows. A rollback, if required, is a separately reviewed forward-only migration that disables v2 acceptance while preserving v2 records and outbox auditability.
