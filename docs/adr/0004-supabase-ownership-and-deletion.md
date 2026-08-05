# ADR 0004: Enforce owner-scoped Supabase data and defer physical object deletion

## Status

Accepted for Milestone 1.

## Decision

Use `auth.users.id` as the root owner identity. Store `user_id` on all user-owned records and enforce same-owner relationships with composite foreign keys. Enable forced RLS with owner-read policies only; trusted FastAPI mutations use the server-only `SUPABASE_SECRET_KEY`.

Create private Storage bucket policies, deletion-request state helpers, queues, and retention-candidate functions. Do not implement Storage API deletion, signed URL routes, or a scheduled retention job.

## Consequences

Database cascades and deletion state prove relational integrity only. They do not prove object-byte deletion in Storage. Future orchestration must delete objects through the Storage API before marking deletion work complete.
