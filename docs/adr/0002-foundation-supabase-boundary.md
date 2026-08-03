# ADR 0002: Keep Supabase as a zero-data scaffold in Milestone 0

## Status

Accepted for Milestone 0.

## Decision

Create only `supabase/config.toml`, empty migrations/tests directories, and an empty-data seed script. Do not add product tables, policies, queues, Storage, or pgvector configuration.

## Consequences

Future schema work starts with a clean, forward-only migration history. Foundation verification does not require a Supabase project or local Docker runtime.
