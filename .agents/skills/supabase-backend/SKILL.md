---
name: supabase-backend
description: Use for Supabase Auth, PostgreSQL, SQL migrations, Storage, Queues, Row Level Security, pgvector, retention, or deletion workflows in this project.
---

# Supabase backend

Read applicable `AGENTS.md`, every existing migration, architecture/security/deployment docs, environment examples, and tests before changes. Supabase SQL migrations are canonical history: never edit applied production migrations; add forward-only corrective migrations and document corrective or rollback strategy.

Use UUID primary keys, UTC timestamps, foreign keys, suitable indexes, uniqueness, and checks; avoid unnecessary JSONB. Enable RLS on every user-owned table, derive identity from validated auth context, never trust body user IDs, and test isolation with two users. Do not expose Supabase secret keys in browser clients.

Keep buckets private; store only redacted screenshots and provide short-lived signed URLs. Queue references, not large payloads. Make consumers idempotent with visibility timeouts, retry limits, and dead-letter behavior. Tie vectors to owner/source entities. Deletion must remove vectors and objects; retention cleanup must be idempotent.

Verify migration ordering, local reset, schema validation, RLS, Storage policies, queue read/ack/retry, deletion cascade, generated client types, and no client secret-key usage. Use established local commands and report unavailable infrastructure honestly.
