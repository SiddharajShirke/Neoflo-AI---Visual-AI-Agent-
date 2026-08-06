# Session lifecycle and idempotency implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Safely convert unreleased session lifecycle states and make event-batch retries produce exactly one durable result.

**Architecture:** A repaired lifecycle migration performs one atomic conversion. A single PostgreSQL RPC owns the idempotency claim, validation, event insertion, outbox insertion, and safe response storage in one transaction. API and repository layers only validate, calculate a deterministic hash, call that RPC, and map typed results to HTTP responses.

**Tech Stack:** PostgreSQL/Supabase RPC and pgTAP; FastAPI/Pydantic; httpx PostgREST adapter; pytest.

## Global Constraints

- Do not edit Milestone 1 migrations or use broad `CASCADE`.
- Do not commit, merge, push, or mutate a remote Supabase project.
- Derive owner identity from verified JWT only; do not log raw idempotency keys or browser fields.
- Store no raw event-batch request body; retain only hash and safe response counts.
- Write and observe each test failing before changing production code.
- Local reset, pgTAP, and disposable integration checks are blocked until Docker is available.

---

### Task 1: Prove and repair the lifecycle conversion

**Files:**

- Modify: `supabase/migrations/0010_session_lifecycle.sql`
- Modify: `apps/api/tests/test_migration_safety.py`
- Modify: `supabase/tests/006_milestone_2_api_primitives.sql`

**Interfaces:**

- Produces the final `public.monitoring_session_status` enum: `recording`, `paused`, `completed`, `cancelled`.
- Produces `public.transition_monitoring_session(uuid, uuid, public.monitoring_session_status)`.

- [ ] **Step 1: Write failing lifecycle source-safety tests**

```python
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]

def migration_text() -> str:
    return (ROOT / "supabase/migrations/0010_session_lifecycle.sql").read_text(encoding="utf-8")

def test_lifecycle_migration_removes_default_before_enum_conversion() -> None:
    migration = migration_text()
    assert migration.index("alter column status drop default") < migration.index(
        "alter column status type"
    )

def test_lifecycle_migration_has_no_broad_cascade() -> None:
    assert "cascade" not in migration_text().lower()
```

- [ ] **Step 2: Run the focused tests and observe the expected failure**

Run: `.venv\Scripts\pytest.exe apps/api/tests/test_migration_safety.py -v`

- [ ] **Step 3: Repair `0010` minimally**

Ensure the migration executes this order: count and reject `expired`/unexpected rows; drop status checks; drop the old `active` default; create temporary enum; cast with `CASE status::text WHEN 'active' THEN 'recording' WHEN 'stopped' THEN 'completed' WHEN 'paused' THEN 'paused' END`; drop/rename the old enum; set `recording` default; recreate lifecycle check/index/function/grants; assert no legacy label/value remains.

- [ ] **Step 4: Add pgTAP post-migration assertions**

```sql
select is(
  (select column_default from information_schema.columns
   where table_schema = 'public' and table_name = 'monitoring_sessions' and column_name = 'status'),
  $$'recording'::public.monitoring_session_status$$,
  'session default is recording'
);
select throws_ok(
  $$select public.transition_monitoring_session('30000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000c1', 'paused')$$,
  'P0001', 'invalid session transition', 'terminal state cannot transition'
);
```

- [ ] **Step 5: Verify focused tests**

Run: `.venv\Scripts\pytest.exe apps/api/tests/test_migration_safety.py -v`

Run when Docker is available: `pnpm.cmd exec supabase db reset` and `pnpm.cmd exec supabase test db`.

### Task 2: Define typed idempotency outcomes in the database

**Files:**

- Modify: `supabase/migrations/0011_event_ingestion_idempotency.sql`
- Modify: `supabase/tests/006_milestone_2_api_primitives.sql`

**Interfaces:**

- RPC accepts owner, route, idempotency key, request hash, device, session, and events.
- RPC returns `outcome`, `response_status`, `accepted_count`, and `duplicate_count`.

- [ ] **Step 1: Add failing SQL assertions for record isolation and safe storage**

```sql
select ok(not has_table_privilege('authenticated', 'public.api_idempotency_records', 'select'),
  'authenticated users cannot read idempotency records');
select ok(not has_table_privilege('anon', 'public.api_idempotency_records', 'select'),
  'anonymous users cannot read idempotency records');
```

- [ ] **Step 2: Run pgTAP and observe failure**

Run when Docker is available: `pnpm.cmd exec supabase test db`.

- [ ] **Step 3: Make the idempotency record a protected state machine**

Add an `in_progress|completed` state and safe response fields. Enforce one row per `(user_id, idempotency_key)` so route mismatches can be detected. Keep `route` and `request_sha256` as comparison fields; do not add a body column or a client-supplied owner column.

- [ ] **Step 4: Replace ingestion RPC with one atomic typed-result RPC**

```sql
create or replace function public.ingest_browser_event_batch(
  p_user_id uuid, p_route text, p_device_id uuid, p_session_id uuid,
  p_events jsonb, p_idempotency_key text, p_request_sha256 text
)
returns table (outcome text, response_status integer, accepted_count integer, duplicate_count integer)
language plpgsql security definer set search_path = public, pg_catalog as $$
begin
  -- Lock or create owner/key record, then compare route/hash.
  -- Validate owner-scoped device/session/consent, insert events/outbox, and update only safe counts.
  -- A raised exception aborts the entire function transaction.
end;
$$;
```

Failures must be raised, not converted to successful records, so PostgreSQL rolls back the claimed record, events, and outbox rows together.

- [ ] **Step 5: Add pgTAP transition, privilege, no-raw-body, and rollback assertions**

Run when Docker is available: `pnpm.cmd exec supabase test db`.

### Task 3: Add a small typed Python result boundary

**Files:**

- Modify: `apps/api/src/visual_ai_api/store.py`
- Modify: `apps/api/src/visual_ai_api/postgres.py`
- Modify: `apps/api/src/visual_ai_api/main.py`
- Test: `apps/api/tests/test_postgres_repository.py`
- Test: `apps/api/tests/test_api_security_and_lifecycle.py`

**Interfaces:**

- `IngestResult(outcome: Literal['created', 'completed', 'conflict', 'in_progress'], accepted_count: int | None, duplicate_count: int | None)`.
- `Repository.ingest(owner, route, device_id, session_id, events, key, request_hash) -> IngestResult`.

- [ ] **Step 1: Write failing API tests**

```python
def test_exact_event_batch_retry_returns_original_counts() -> None:
    api, body = prepared_event_batch_client()
    first = api.post('/api/v1/events/batch', headers={**auth(), 'Idempotency-Key': 'retry-1'}, json=body)
    retry = api.post('/api/v1/events/batch', headers={**auth(), 'Idempotency-Key': 'retry-1'}, json=body)
    assert retry.status_code == first.status_code == 202
    assert retry.json() == first.json()

def test_changed_event_with_same_key_returns_idempotency_conflict() -> None:
    api, body = prepared_event_batch_client()
    assert api.post('/api/v1/events/batch', headers={**auth(), 'Idempotency-Key': 'conflict-1'}, json=body).status_code == 202
    body['events'][0]['client_event_id'] = 'different-event'
    response = api.post('/api/v1/events/batch', headers={**auth(), 'Idempotency-Key': 'conflict-1'}, json=body)
    assert (response.status_code, response.json()['error']['code']) == (409, 'idempotency_key_reused')

def test_key_length_above_128_is_rejected() -> None:
    api, body = prepared_event_batch_client()
    response = api.post('/api/v1/events/batch', headers={**auth(), 'Idempotency-Key': 'x' * 129}, json=body)
    assert (response.status_code, response.json()['error']['code']) == (400, 'invalid_idempotency_key')
```

- [ ] **Step 2: Run focused API tests and observe failure**

Run: `.venv\Scripts\pytest.exe apps/api/tests/test_api_security_and_lifecycle.py -v`

- [ ] **Step 3: Change the protocol and API mapping**

Pass the constant route `'/api/v1/events/batch'`, verified `CurrentUser.id`, header key, and canonical hash to `Repository.ingest`. Map `conflict` to `ApiError(409, 'idempotency_key_reused', 'The idempotency key was reused.')`, `in_progress` to a deterministic retryable conflict, and successful outcomes to the stored `202` response.

- [ ] **Step 4: Update `PostgrestRepository`**

Call only `/rpc/ingest_browser_event_batch`, include the new route parameter, and decode its typed row. Do not make direct inserts or use a memory fallback.

- [ ] **Step 5: Update `MemoryRepository`**

Use `(owner, external_key)` as the claim key. Compare route and hash; cache only counts/status; ensure an exact retry does not append events or outbox-equivalent records.

- [ ] **Step 6: Verify focused API and transport tests**

Run: `.venv\Scripts\pytest.exe apps/api/tests/test_api_security_and_lifecycle.py apps/api/tests/test_postgres_repository.py -v`

### Task 4: Prove canonical hashing and isolation behavior

**Files:**

- Modify: `apps/api/tests/test_api_security_and_lifecycle.py`
- Modify: `apps/api/tests/test_postgres_repository.py`
- Create: `apps/api/tests/test_event_idempotency_integration.py`

**Interfaces:**

- `event_batch_request_hash(EventBatch) -> str` remains deterministic and covers all persistence-affecting fields.

- [ ] **Step 1: Add failing hash tests**

```python
def test_event_batch_hash_ignores_json_object_key_order() -> None:
    first = EventBatch.model_validate({'device_id': DEVICE_ID, 'session_id': SESSION_ID, 'events': [EVENT]})
    second = EventBatch.model_validate({'events': [EVENT], 'session_id': SESSION_ID, 'device_id': DEVICE_ID})
    assert event_batch_request_hash(first) == event_batch_request_hash(second)

def test_event_batch_hash_changes_when_event_content_changes() -> None:
    first = EventBatch.model_validate({'device_id': DEVICE_ID, 'session_id': SESSION_ID, 'events': [EVENT]})
    changed = {**EVENT, 'client_event_id': 'event-2'}
    second = EventBatch.model_validate({'device_id': DEVICE_ID, 'session_id': SESSION_ID, 'events': [changed]})
    assert event_batch_request_hash(first) != event_batch_request_hash(second)
```

- [ ] **Step 2: Run hash tests and observe failure if canonical coverage is incomplete**

Run: `.venv\Scripts\pytest.exe apps/api/tests/test_api_security_and_lifecycle.py -v`

- [ ] **Step 3: Make only the necessary canonicalization change**

Use `model_dump(mode='json')`, stable sorted object keys, compact separators, and UTF-8 SHA-256. Do not include transient headers, raw request bytes, or object insertion order.

- [ ] **Step 4: Add disposable Supabase integration cases**

Cover initial insert, exact retry with unchanged counts, changed body conflict, forced event/outbox failure rollback, different owners sharing the same external key, concurrent identical requests, role denial, and absence of a raw-body column. Use synthetic identities and local URLs only.

- [ ] **Step 5: Verify unit tests now; run integration tests only with Docker**

Run: `.venv\Scripts\pytest.exe apps/api/tests -v`

Run when Docker is available: `.venv\Scripts\pytest.exe apps/api/tests/test_event_idempotency_integration.py -v`.

### Task 5: Full verification and security review

**Files:**

- Modify only if a test exposes a defect from Tasks 1-4.

- [ ] **Step 1: Run static and unit verification**

```powershell
.venv\Scripts\ruff.exe check .
.venv\Scripts\mypy.exe apps/api/src apps/worker/src packages/python-shared/src
.venv\Scripts\pytest.exe -v
pnpm.cmd format:check
pnpm.cmd lint
pnpm.cmd typecheck
pnpm.cmd test
pnpm.cmd build
pnpm.cmd secret:scan
pnpm.cmd run supabase:migration-check
.venv\Scripts\python.exe -c "from visual_ai_api.main import app; print(app.title)"
git diff --check
```

- [ ] **Step 2: Run Docker-backed database verification when available**

```powershell
pnpm.cmd exec supabase db reset
pnpm.cmd exec supabase test db
```

- [ ] **Step 3: Generate and validate OpenAPI**

```powershell
.venv\Scripts\python.exe -c "from visual_ai_api.main import app; assert '/api/v1/events/batch' in app.openapi()['paths']"
```

- [ ] **Step 4: Report evidence and limitations**

Report exact command output, pgTAP count, clean-reset status, privacy findings with evidence/remediation/tests, and changed-file summary. State `NOT READY` if Docker-backed reset/integration verification remains unavailable.
