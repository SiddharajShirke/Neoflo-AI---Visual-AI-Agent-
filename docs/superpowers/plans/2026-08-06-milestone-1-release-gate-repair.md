# Milestone 1 Release-Gate Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair the Milestone 1 SQL verification suite and release checks without extending product scope.

**Architecture:** Keep deployed migrations unchanged. Exercise existing database constraints and policies through synthetic pgTAP transactions, using each test file as an independent rollback-safe fixture. Correct only invalid test fixtures, add behavioral assertions, and format existing files.

**Tech Stack:** Supabase CLI 2.111.0, PostgreSQL/pgTAP/PGMQ, pnpm, Prettier.

## Global Constraints

- Do not add API routes, extension capture, screenshot orchestration, signed URLs, LangGraph/LLM behavior, dashboard product pages, retention schedules, or deployment changes.
- Do not alter deployed migrations; all new coverage lives in `supabase/tests/`.
- Tests use fixed synthetic UUIDs and `example.test` addresses only, create fixtures inside transactions, and roll them back.
- Do not reset production, access production data, commit, or merge.

---

### Task 1: Repair test fixtures and schema/idempotency coverage

**Files:**

- Modify: `supabase/tests/001_schema_constraints.sql`
- Modify: `supabase/tests/002_rls_two_user_isolation.sql`
- Modify: `supabase/tests/005_deletion_integrity.sql`

**Interfaces:**

- Consumes: `public.monitoring_sessions` state constraint, composite ownership foreign keys, and `public.browser_events` unique `(device_id, client_event_id)` constraint.
- Produces: valid two-user fixtures plus executable assertions that reject invalid states, cross-owner links, and duplicate browser events.

- [ ] **Step 1: Write failing pgTAP assertions**

Add `throws_ok` assertions for an invalid stopped session, cross-user device/session references, and a duplicate browser-event client identifier. Keep stopped fixture rows valid by using `ended_at = now()`.

- [ ] **Step 2: Run the SQL suite to verify the current fixture failure**

Run: `supabase test db --linked`

Expected: current test run cannot complete in this host until Docker Desktop is available; the static fixture contradiction is reproducible from the schema check and test insert.

- [ ] **Step 3: Apply the minimal fixture corrections and assertions**

Use `ended_at` for every `stopped` test session. Assert PostgreSQL error `23514` for invalid session state and `23503` for cross-owner foreign keys / duplicate event identity as appropriate.

- [ ] **Step 4: Re-run focused SQL verification**

Run: `supabase test db --linked`

Expected: pgTAP executes all assertions when Docker Desktop is available; otherwise record the Docker prerequisite exactly.

### Task 2: Add policy, queue, deletion, and domain-rule behavior coverage

**Files:**

- Modify: `supabase/tests/002_rls_two_user_isolation.sql`
- Modify: `supabase/tests/003_storage_policies.sql`
- Modify: `supabase/tests/004_queue_contracts.sql`
- Modify: `supabase/tests/005_deletion_integrity.sql`

**Interfaces:**

- Consumes: owner-scoped RLS policies, `redacted-screenshots` bucket policy, queue helpers, deletion tables, and `domain_rules` constraints.
- Produces: assertions for user-A/user-B visibility, bucket privacy/path ownership, actual reference-only messages, deletion cascade behavior, and system-rule immutability to authenticated users.

- [ ] **Step 1: Write failing behavioral assertions**

Add a storage-object fixture per synthetic user, send a valid queue message and inspect its JSON object keys, create an event-derived record and delete its session to assert cascade removal, and assert authenticated users cannot insert/update/delete a system domain rule.

- [ ] **Step 2: Run the SQL suite to verify failures are meaningful**

Run: `supabase test db --linked`

Expected: unavailable only when Docker Desktop is not running; otherwise each new assertion passes against the already-deployed schema.

- [ ] **Step 3: Keep assertions isolated and rollback-safe**

Use existing table APIs and pgTAP assertions only. Do not change migrations or add runtime code.

- [ ] **Step 4: Re-run focused SQL verification**

Run: `supabase test db --linked`

Expected: all test transactions roll back fixture rows; pgTAP availability is the sole external prerequisite.

### Task 3: Format and release-verify

**Files:**

- Modify: repository files reported by `pnpm format:check`

**Interfaces:**

- Consumes: existing pnpm, Python, and Supabase scripts.
- Produces: fresh evidence for all available release checks.

- [ ] **Step 1: Format the repository**

Run: `pnpm format`

- [ ] **Step 2: Verify formatting and quality checks**

Run: `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:contract`, `pnpm build`, `pnpm secret:scan`, and `pnpm supabase:migration-check`.

- [ ] **Step 3: Verify Python and linked staging checks**

Run the documented Python commands plus `supabase migration list --linked`, `supabase db lint --linked --fail-on error`, `supabase test db --linked`, and `supabase db push --dry-run`.

- [ ] **Step 4: Review scope and report exact status**

Run: `git diff --check`, `git status --short`, and `git log --graph --oneline --decorate -20`.

Expected: no scope expansion, no commit, and a decision based only on fresh output.
