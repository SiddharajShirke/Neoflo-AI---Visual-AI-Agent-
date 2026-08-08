# Milestone 4-A Browser Event v2 Backend/Database Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce a privacy-minimized navigation-only Browser Event v2 ingestion gate across canonical contracts, FastAPI, PostgreSQL, transactional outbox, and lifecycle semantics, without implementing extension capture.

**Architecture:** Preserve all v1 schemas, generated types, persisted rows, and historical semantics. The existing `POST /api/v1/events/batch` becomes the v2-only ingestion boundary; strict v2 validation accepts only a normalized registrable domain and a bounded transition type. A forward-only Supabase migration records v2-specific fields, enforces separation from legacy content fields, and returns typed safe authorization outcomes. After a successful transaction, FastAPI performs one bounded best-effort outbox publication attempt; a publisher failure never converts a committed ingestion response into a failure.

**Tech Stack:** JSON Schema 2020-12, TypeScript/Vitest/pnpm, FastAPI/Pydantic/pytest, PostgreSQL PL/pgSQL/Supabase/PGMQ/pgTAP.

## Global Constraints

- Work only on `feature/browser-event-capture`; do not commit, push, merge, or modify applied migrations.
- Add exactly one forward-only migration, `0017_m4_browser_event_v2_gate.sql`; a rollback is a separately reviewed later migration.
- Preserve v1 schema files, v1 fixtures, v1 generated exports, and the historical meaning of v1 database rows.
- The M4 endpoint accepts only v2 navigation events: UUID `client_event_id`, positive integer `sequence_number`, `event_kind`, `occurred_at`, `page_domain`, `transition_type`, and `capture_policy_version`.
- For v2, `client_event_id` is an RFC 4122 UUID at every contract/API/RPC boundary. The immutable v1 `browser_events.client_event_id text` column remains historical; migration `0017` adds `client_event_uuid uuid` and v2 identity semantics use that UUID with a conditional unique index.
- For v2, `sequence_number` is an integer with minimum `1`. Zero and negative values remain possible only in historical v1 rows and must be rejected from every v2 boundary.
- `event_kind` is the literal `navigation`; `page_domain` is a lowercase registrable public domain without protocol, hostname subdomain, port, path, query, fragment, or credentials.
- Prohibit URL/origin/host/port/path/query/fragment/title/DOM/text/accessibility/tab/document/process/transition-qualifier fields at every v2 contract, API, and RPC boundary.
- The server derives user identity exclusively from the verified JWT subject. The browser never receives a Supabase service key and never invokes `/api/v1/internal/outbox/publish`.
- Event ingestion must verify active owner device, recording owner session, active monitoring consent, and exact capture-policy-version match.
- The event transaction must include browser event insertion, event-outbox insertion, and idempotency completion. Queue payloads contain only `browser_event_id` and `contract_version`.
- No `webNavigation`, content script, URL collection, extension event buffering, DOM/title/screenshot/click/scroll/keyboard capture, AI, LLM, or worker consumer work belongs in M4-A.
- Follow red-green-refactor: every behavior change starts with a focused test that is run and observed to fail for the missing behavior before production code changes.
- Use only synthetic identifiers, domains, and timestamps in tests. Do not log request bodies, browser fields, tokens, or service keys.

---

## Planned File Structure

| File                                                                           | Responsibility                                                                            |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| `schemas/events/browser-event.v2.schema.json`                                  | Strict canonical v2 event request item.                                                   |
| `schemas/events/browser-event-batch.v2.schema.json`                            | Strict v2 batch envelope with device/session ownership metadata only.                     |
| `schemas/events/fixtures/browser-event-batch.v2.valid.json`                    | Shared safe v2 fixture.                                                                   |
| `schemas/events/fixtures/browser-event-batch.v2.invalid-prohibited-field.json` | Shared fixture proving every rejected privacy field is unknown.                           |
| `scripts/generate-contracts.mjs`                                               | Deterministically generates a separate v2 TypeScript artifact without altering v1 output. |
| `packages/contracts/src/generated/browser-event-v2.ts`                         | Generated v2 type definitions; never hand-edit.                                           |
| `packages/contracts/src/browser-event-v2.ts`                                   | Strict handwritten runtime validators for v2 JSON-schema rules.                           |
| `packages/contracts/src/index.ts`                                              | Stable v1 exports plus additive v2 exports and schema-version marker.                     |
| `packages/contracts/tests/browser-event-v2-contract.test.ts`                   | Canonical TypeScript contract regression coverage.                                        |
| `apps/api/src/visual_ai_api/schemas.py`                                        | Separate Pydantic v1 historical types and v2 ingestion models.                            |
| `apps/api/src/visual_ai_api/store.py`                                          | Typed ingestion outcomes and deterministic in-memory authorization/policy behavior.       |
| `apps/api/src/visual_ai_api/postgres.py`                                       | RPC outcome mapping; no generic conversion of expected authorization state to `503`.      |
| `apps/api/src/visual_ai_api/main.py`                                           | v2 endpoint validation, safe outcome mapping, post-commit bounded outbox attempt.         |
| `apps/api/tests/test_event_contract.py`                                        | v1 preservation and v2 contract/OpenAPI/privacy assertions.                               |
| `apps/api/tests/test_event_idempotency.py`                                     | v2 replay, conflict, duplicate event identity, and policy binding tests.                  |
| `apps/api/tests/test_api_security_and_lifecycle.py`                            | HTTP outcome mapping and post-commit publishing behavior.                                 |
| `apps/api/tests/test_postgres_repository.py`                                   | v2 RPC serialization and typed outcome tests.                                             |
| `supabase/migrations/0017_m4_browser_event_v2_gate.sql`                        | Forward-only v2 columns, checks, RPC replacement, version-2 outbox support.               |
| `supabase/tests/007_m4_browser_event_v2_gate.sql`                              | pgTAP privacy, authorization, transaction, concurrency, and queue assertions.             |
| `docs/adr/0006-m4-navigation-event-v2-privacy-boundary.md`                     | Durable decision record for the M4-A boundary.                                            |

## Interface Decisions

```python
class BrowserEventV2(StrictModel):
    client_event_id: UUID
    sequence_number: int = Field(ge=1)
    event_kind: Literal["navigation"]
    occurred_at: datetime
    page_domain: str
    transition_type: Literal[
        "link", "typed", "auto_bookmark",
        "generated", "start_page", "form_submit", "reload", "keyword", "keyword_generated",
    ]
    capture_policy_version: str

class EventBatchV2(StrictModel):
    device_id: UUID
    session_id: UUID
    events: list[BrowserEventV2]
```

`client_event_id` uses JSON Schema `format: uuid`, generated TypeScript `string`, runtime UUID-pattern validation, Pydantic `UUID`, an RPC `uuid` cast, and `browser_events.client_event_uuid uuid` persistence for v2 identity. `page_domain` must match `^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z]{2,63}$`, have length at most 253, and be semantically validated server-side as lowercase public-domain syntax. The extension will later perform registrable-domain derivation; M4-A only validates the already-minimized value.

```python
@dataclass(frozen=True)
class IngestResult:
    outcome: Literal[
        "created", "completed", "conflict", "in_progress",
        "device_inactive", "consent_inactive", "session_not_recording", "policy_mismatch",
    ]
    response_status: int | None
    accepted_count: int | None
    duplicate_count: int | None
```

HTTP mappings are fixed: missing/invalid JWT remains `401`; malformed v2 payload is FastAPI `422 invalid_request`; idempotency reuse is `409 idempotency_key_reused`; `device_inactive` is `409 device_revoked`; `consent_inactive` is `409 consent_inactive`; `session_not_recording` is `409 session_not_recording`; and `policy_mismatch` is `409 capture_policy_mismatch`. Unknown repository/database failures remain `503 database_unavailable`.

The PostgREST RPC returns these outcomes instead of raising for expected state validation. It retains a `SECURITY DEFINER`, service-role-only signature. For v2 inserts it always writes `event_contract_version = 2`, `page_domain`, `transition_type`, and NULL in every v1 content-style column. It creates `event_outbox.contract_version = 2` in the same transaction.

## Endpoint-Compatibility Gate

Before changing `POST /api/v1/events/batch` to accept only v2, run and record this repository-wide search from the repository root:

```powershell
rg -n --glob '!docs/superpowers/plans/**' --glob '!**/tests/**' --glob '!schemas/**' '/api/v1/events/batch|events/batch' .
rg -n --glob '!docs/superpowers/plans/**' --glob '!**/tests/**' --glob '!schemas/**' 'ingest\(|BrowserEvent\(|EventBatch\(' apps packages
```

If neither search finds a runtime caller that sends a v1 browser-event body, record the exact zero-runtime-caller evidence in the ADR and proceed with v2-only endpoint behavior. If any runtime caller sends or depends on a v1 body, stop implementation and report `DESIGN BLOCKED`; do not change endpoint behavior or add a compatibility guess.

### Task 1: Establish v1/v2 contract regression tests and canonical fixtures

**Files:**

- Create: `schemas/events/browser-event.v2.schema.json`
- Create: `schemas/events/browser-event-batch.v2.schema.json`
- Create: `schemas/events/fixtures/browser-event-batch.v2.valid.json`
- Create: `schemas/events/fixtures/browser-event-batch.v2.invalid-prohibited-field.json`
- Create: `packages/contracts/tests/browser-event-v2-contract.test.ts`
- Modify: `packages/contracts/tests/browser-event-contract.test.ts`
- Modify: `packages/contracts/tests/schema-versions.test.ts`

**Consumes:** Existing immutable v1 schema and fixture files.

**Produces:** Exact v2 schema/fixtures and failing tests that define the public contract before validators or generated types exist.

- [ ] **Step 1: Write the failing v2 fixture/validator tests.**

```ts
it('accepts only the navigation-only v2 fixture', () => {
  expect(isBrowserEventBatchV2(validFixture)).toBe(true);
  expect(validFixture.events[0]).toEqual({
    client_event_id: '11111111-1111-4111-8111-111111111111',
    sequence_number: 1,
    event_kind: 'navigation',
    occurred_at: '2026-08-08T10:00:00Z',
    page_domain: 'example.test',
    transition_type: 'link',
    capture_policy_version: 'm4-navigation-v1'
  });
});

it.each([
  'url',
  'page_url',
  'page_origin',
  'host',
  'port',
  'path',
  'query',
  'fragment',
  'page_title_redacted',
  'dom',
  'text',
  'accessibility_context_redacted',
  'tab_id',
  'document_id',
  'process_id',
  'transition_qualifiers'
])('rejects prohibited v2 field %s', (field) => {
  expect(isBrowserEventBatchV2(withField(field))).toBe(false);
});

it.each([0, -1])('rejects non-positive sequence number %i', (sequence_number) => {
  expect(
    isBrowserEventBatchV2({
      ...validFixture,
      events: [{ ...validFixture.events[0], sequence_number }]
    })
  ).toBe(false);
});

it('rejects a non-UUID client event identifier', () => {
  expect(
    isBrowserEventBatchV2({
      ...validFixture,
      events: [{ ...validFixture.events[0], client_event_id: 'not-a-uuid' }]
    })
  ).toBe(false);
});
```

Also add a v1 regression assertion that its schema ID, required fields, optional fields, and existing valid fixture remain byte-for-byte compatible with the current public contract.

- [ ] **Step 2: Run the focused contract tests and observe the expected red failure.**

Run: `pnpm --filter @visual-ai/contracts test -- browser-event-v2-contract.test.ts`

Expected: FAIL because `isBrowserEventBatchV2` and its fixture/schema do not exist.

- [ ] **Step 3: Add the strict schemas and fixtures.**

Use `additionalProperties: false` on both objects. Require every v2 event field. Use `format: "uuid"` for `client_event_id`, `minimum: 1` for `sequence_number`, `const: "navigation"` for `event_kind`, the domain pattern above for `page_domain`, and the top-level-only Chrome transition enum: `link`, `typed`, `auto_bookmark`, `generated`, `start_page`, `form_submit`, `reload`, `keyword`, and `keyword_generated`. The batch schema permits only `device_id`, `session_id`, and `events`.

The invalid fixture must contain one valid event plus `"page_origin": "https://example.test"`; parameterized tests create all other prohibited properties from that valid base so each rejection is explicit.

- [ ] **Step 4: Re-run the focused test and confirm it still fails only for the missing validator.**

Run: `pnpm --filter @visual-ai/contracts test -- browser-event-v2-contract.test.ts`

Expected: FAIL with the missing v2 export, not with malformed fixture/schema JSON.

- [ ] **Step 5: Do not commit.**

Leave the tested changes uncommitted as explicitly required for this milestone.

### Task 2: Add additive v2 generated types and runtime validators

**Files:**

- Modify: `scripts/generate-contracts.mjs`
- Modify: `scripts/generate-contracts.test.mjs`
- Create: `packages/contracts/src/generated/browser-event-v2.ts`
- Create: `packages/contracts/src/browser-event-v2.ts`
- Modify: `packages/contracts/src/index.ts`
- Test: `packages/contracts/tests/browser-event-v2-contract.test.ts`
- Test: `packages/contracts/tests/browser-event-contract.test.ts`
- Test: `packages/contracts/tests/schema-versions.test.ts`

**Consumes:** Task 1 v2 JSON schemas.

**Produces:** `BrowserEventV2`, `BrowserEventBatchV2`, `isBrowserEventV2`, and `isBrowserEventBatchV2`, while retaining every v1 export unchanged.

- [ ] **Step 1: Extend the failing tests with additive-export assertions.**

```ts
it('keeps v1 and publishes v2 independently', () => {
  expect(schemaVersions.browserEvent).toBe('v1');
  expect(schemaVersions.browserEventV2).toBe('v2');
  expect(isBrowserEventBatch(v1ValidFixture)).toBe(true);
  expect(isBrowserEventBatchV2(v1ValidFixture)).toBe(false);
  expect(isBrowserEventBatchV2(v2ValidFixture)).toBe(true);
});
```

- [ ] **Step 2: Run the focused contract tests and observe red.**

Run: `pnpm --filter @visual-ai/contracts test -- browser-event-v2-contract.test.ts schema-versions.test.ts`

Expected: FAIL because the v2 generated artifact and public exports do not exist.

- [ ] **Step 3: Implement the smallest additive generator and validator.**

Keep the v1 `browser-event.ts` generation path unchanged. Add separate v2 schema input paths and generate `browser-event-v2.ts` with `BrowserEventV2` and `BrowserEventBatchV2` names. Add a focused validator module that checks object keys first, then UUID client/batch IDs, positive integer sequence numbers, domain pattern/lowercase condition, literal navigation kind, top-level transition enum, and 1–100 events. Export it additively from `index.ts` and add `browserEventV2: 'v2'` without renaming `browserEvent: 'v1'`.

- [ ] **Step 4: Generate artifacts and verify green.**

Run: `pnpm contracts:generate`

Expected: reports generated v1, v2, and control-plane artifacts without changing v1 semantics.

Run: `pnpm --filter @visual-ai/contracts test -- browser-event-contract.test.ts browser-event-v2-contract.test.ts schema-versions.test.ts`

Expected: PASS.

- [ ] **Step 5: Check deterministic generation.**

Run: `pnpm contracts:check && pnpm contracts:generate:test`

Expected: PASS; generated artifact drift check passes.

- [ ] **Step 6: Do not commit.**

### Task 3: Define failing FastAPI v2 contract and safe-error tests

**Files:**

- Modify: `apps/api/tests/test_event_contract.py`
- Modify: `apps/api/tests/test_event_idempotency.py`
- Modify: `apps/api/tests/test_api_security_and_lifecycle.py`
- Modify: `apps/api/tests/test_postgres_repository.py`

**Consumes:** Task 1 fixtures and Task 2 public contract names.

**Produces:** Failing tests for all M4-A API behavior before Pydantic, repository, or route changes.

- [ ] **Step 1: Add Pydantic/OpenAPI/privacy tests.**

```python
def test_v2_accepts_navigation_domain_only_and_v1_remains_historical() -> None:
    v2 = EventBatchV2.model_validate(load_v2_fixture())
    assert isinstance(v2.events[0].client_event_id, UUID)
    assert v2.events[0].sequence_number == 1
    assert v2.events[0].page_domain == "example.test"
    assert BrowserEventV1.model_validate(load_v1_fixture()).page_origin == "https://example.test"

@pytest.mark.parametrize("field", PROHIBITED_V2_FIELDS)
def test_v2_rejects_every_prohibited_browser_field(field: str) -> None:
    with pytest.raises(ValidationError):
        EventBatchV2.model_validate(v2_payload_with(field, "synthetic"))

@pytest.mark.parametrize("value", [0, -1])
def test_v2_rejects_non_positive_sequence_number(value: int) -> None:
    with pytest.raises(ValidationError):
        EventBatchV2.model_validate(v2_payload_with("sequence_number", value))
```

Assert the OpenAPI event endpoint request body references `EventBatchV2`, no prohibited field appears in its item schema, and the existing v1 model remains available for historical contract checks.

- [ ] **Step 2: Add endpoint behavior tests using `MemoryRepository`.**

```python
def test_v2_batch_rejects_a_revoked_device_with_safe_code() -> None:
    api, device_id, session_id = prepared_api_session()
    api.post(f"/api/v1/devices/{device_id}/revoke", headers=auth())
    response = api.post("/api/v1/events/batch", headers=event_headers(), json=v2_batch(device_id, session_id))
    assert (response.status_code, response.json()["error"]["code"]) == (409, "device_revoked")
```

Add one isolated test each for inactive consent (`consent_inactive`), paused/completed session (`session_not_recording`), mismatched capture policy (`capture_policy_mismatch`), exact idempotency replay, changed-body key conflict, exact duplicate client event ID, and client event ID reused with changed content (`event_id_conflict`).

- [ ] **Step 3: Add post-commit outbox behavior tests.**

```python
class PublishingRepository(MemoryRepository):
    publish_calls = 0
    async def publish_outbox(self, limit: int) -> tuple[int, int, int]:
        self.publish_calls += 1
        return (1, 1, 0)

def test_committed_v2_batch_attempts_bounded_outbox_publish() -> None:
    repository = PublishingRepository()
    response = post_valid_v2_batch(client(repository))
    assert response.status_code == 202
    assert repository.publish_calls == 1
```

Add a second repository that raises `ApiError(503, "database_unavailable", ...)` from `publish_outbox`; assert the endpoint still returns the committed `202` ingestion response and does not disclose the publisher failure.

- [ ] **Step 4: Add PostgREST serialization/outcome tests.**

Assert v2 RPC payload contains `page_domain`, `transition_type`, and event fingerprint, but none of the prohibited names. Assert each typed RPC outcome is returned by `PostgrestRepository.ingest` instead of being transformed into `database_unavailable`.

- [ ] **Step 5: Run focused tests and observe red.**

Run: `.venv\\Scripts\\python.exe -m pytest apps/api/tests/test_event_contract.py apps/api/tests/test_event_idempotency.py apps/api/tests/test_api_security_and_lifecycle.py apps/api/tests/test_postgres_repository.py -q`

Expected: FAIL because `EventBatchV2`, safe outcomes, policy binding, and post-commit publisher behavior do not exist.

- [ ] **Step 6: Do not commit.**

### Task 4: Implement typed v2 Python contracts and deterministic repository semantics

**Files:**

- Modify: `apps/api/src/visual_ai_api/schemas.py`
- Modify: `apps/api/src/visual_ai_api/store.py`
- Test: `apps/api/tests/test_event_contract.py`
- Test: `apps/api/tests/test_event_idempotency.py`

**Consumes:** Task 3 failing tests.

**Produces:** `BrowserEventV1`, `EventBatchV1`, `BrowserEventV2`, `EventBatchV2`, strict canonical request hashes, and deterministic typed M4-A results in the test repository.

- [ ] **Step 1: Implement separate models without replacing v1.**

Keep the current v1 field shape under explicit `BrowserEventV1` and `EventBatchV1` names. Add the v2 models from the interface decision above, with `client_event_id: UUID` and `sequence_number: int = Field(ge=1)`. Use `StrictModel` (`extra='forbid'`) for both. Restrict domain with both `min_length=3`, `max_length=253`, pattern, and a Pydantic validator that rejects uppercase input. Do not normalize server input: v2 callers must supply an already-normalized domain.

- [ ] **Step 2: Update hashing names and types.**

```python
def event_batch_v2_request_hash(payload: EventBatchV2) -> str:
    return canonical_request_hash(payload)
```

Retain `event_batch_request_hash` as a v1 historical helper if existing tests/public imports use it; do not silently change its semantics.

- [ ] **Step 3: Add safe repository outcomes.**

In `MemoryRepository.ingest`, check in this order after idempotency replay: owner device active, owner session/device relationship, session status, active monitoring consent, exact policy-version equality, then duplicate sequence/event identity. Raise only `ApiError` values that correspond to the fixed HTTP mappings. Return `IngestResult` typed outcomes for server-state results only if the real RPC uses outcomes; keep changed event identity as `409 event_id_conflict`.

Add `event_contract_version` and v2 event payload metadata to the in-memory event record only as synthetic test metadata; do not store any prohibited field.

- [ ] **Step 4: Run the Task 3 focused Python contract/idempotency tests and verify green.**

Run: `.venv\\Scripts\\python.exe -m pytest apps/api/tests/test_event_contract.py apps/api/tests/test_event_idempotency.py -q`

Expected: PASS.

- [ ] **Step 5: Do not commit.**

### Task 5: Add the forward-only Supabase v2 gate and pgTAP proof

**Files:**

- Create: `supabase/migrations/0017_m4_browser_event_v2_gate.sql`
- Create: `supabase/tests/007_m4_browser_event_v2_gate.sql`
- Modify: `supabase/tests/006_milestone_2_api_primitives.sql`
- Modify: `apps/api/tests/test_migration_safety.py`

**Consumes:** Task 3 database assertions and Task 4 exact v2 fields/outcomes.

**Produces:** Durable schema/RPC/outbox v2 support with transactional and privacy enforcement.

- [ ] **Step 1: Write migration-safety and pgTAP tests first.**

The Python migration test must assert that `0017` is forward-only, does not alter v1 schema files or remove legacy browser-event columns, uses `SECURITY DEFINER`, revokes RPC execution from `public`, `anon`, and `authenticated`, grants only `service_role`, and contains no raw-request storage.

The pgTAP file must begin with an explicit plan count and include isolated synthetic user/device/consent/session rows. Add assertions for:

```sql
select throws_ok(
  $$insert into public.browser_events (..., event_contract_version, page_domain, transition_type,
      page_title_redacted) values (..., 2, 'example.test', 'link', 'must-be-null')$$,
  '23514', null, 'v2 rejects legacy content columns'
);

select throws_ok(
  $$insert into public.browser_events (..., event_contract_version, event_kind, page_domain, transition_type)
      values (..., 2, 'meaningful_action', 'example.test', 'link')$$,
  '23514', null, 'v2 requires navigation kind'
);
```

Also assert valid v1 insert still succeeds, valid v2 insert succeeds, domain/transition fields are required for v2, service-role-only RPC grants remain correct, cross-owner requests have no access, policy mismatch returns `policy_mismatch`, an induced event insert failure rolls back its idempotency claim and outbox row, same client event identity is duplicate-safe, changed identity content conflicts, and PGMQ receives only the UUID plus `contract_version: 2`.

Add a two-session concurrent pgTAP test using `dblink` only if the local test harness already provides it; otherwise use two SQL transactions with `pg_background` only if that extension is already present. If neither is available, document that the deterministic conflict path is covered in pgTAP and add an API/repository concurrent test with `asyncio.gather`; do not introduce a new production extension merely for a test.

- [ ] **Step 2: Run migration and focused test checks to observe red.**

Run: `pnpm supabase:migration-check`

Expected: FAIL because migration `0017` and SQL test `007` are absent or references do not exist.

Run: `.venv\\Scripts\\python.exe -m pytest apps/api/tests/test_migration_safety.py -q`

Expected: FAIL because v2 migration invariants are absent.

- [ ] **Step 3: Add `0017_m4_browser_event_v2_gate.sql`.**

Implement, in order:

1. Add nullable `page_domain text`, nullable `transition_type text`, nullable `client_event_uuid uuid`, and non-null `event_contract_version smallint not null default 1` to `public.browser_events`; existing rows remain v1 without data rewrite.
2. Add a `browser_events_v2_shape_check` that is conditional: non-v2 rows retain historical freedom; v2 rows require navigation, UUID `client_event_uuid`, positive `sequence_number`, domain, transition type, and all v1 content-style columns (`page_origin`, `page_path_hash`, `page_title_redacted`, `accessibility_context_redacted`, `context_sha256`) NULL. The v2 canonical UUID string in legacy `client_event_id` must equal `client_event_uuid::text`.
3. Add v2-only domain, top-level-transition, UUID-string, and positive-sequence checks; create `unique (device_id, client_event_uuid) where event_contract_version = 2`. Do not add URL-like columns or JSONB.
4. Replace `public.ingest_browser_event_batch` with a service-role-only `SECURITY DEFINER` function returning `outcome`, `response_status`, `accepted_count`, and `duplicate_count`. Validate idempotency claims/replays first. Return typed outcomes for inactive device, consent, session state, and policy mismatch. Keep idempotency conflict/in-progress behavior. Do not raise expected-state exceptions.
5. Insert only v2 fields with contract version 2. Compare every event capture-policy version to `monitoring_sessions.capture_policy_version` before any event insert.
6. Parse each v2 `client_event_id` as UUID, write it to `client_event_uuid` and the legacy `client_event_id` text mirror, and use `INSERT ... ON CONFLICT`/locked `(device_id, client_event_uuid)` identity comparison so concurrent identical client-event delivery increments duplicates while changed content yields the existing safe identity conflict. Do not rely solely on a pre-insert `SELECT`.
7. Update `event_outbox.contract_version` constraint to allow 1 and 2. Insert version 2 for v2 events. Retain the existing reference-only `publish_event_outbox` message body, which uses the row’s contract version.
8. Revoke/grant the replacement function exactly as existing privileged functions do. Preserve RLS and existing owner-read policy.

Do not change monitoring-session transition rules: they already reject event ingestion once a session is not recording. M4-A provides the server half of flush-before-pause/complete; the future extension must enforce client ordering.

- [ ] **Step 4: Add the pgTAP test file and update existing plan counts.**

Keep all tests transactional (`begin`/`rollback`). Update `006_milestone_2_api_primitives.sql` only where its direct assertions assume `event_outbox.contract_version = 1`; retain its v1 coverage as v1 coverage.

- [ ] **Step 5: Run local SQL verification and verify green when Docker/Supabase is available.**

Run: `pnpm supabase:migration-check`

Expected: PASS with 17 contiguous migrations and 8 SQL test files.

Run: `supabase db reset`

Expected: applies migrations through `0017` cleanly.

Run: `pnpm supabase:test`

Expected: all pgTAP files, including `007_m4_browser_event_v2_gate.sql`, PASS.

If Docker or the local Supabase CLI runtime is unavailable, record the exact unavailable command/error; do not claim SQL integration verification passed.

- [ ] **Step 6: Do not commit.**

### Task 6: Wire PostgREST typed outcomes and FastAPI v2 ingestion

**Files:**

- Modify: `apps/api/src/visual_ai_api/postgres.py`
- Modify: `apps/api/src/visual_ai_api/main.py`
- Modify: `apps/api/src/visual_ai_api/store.py`
- Test: `apps/api/tests/test_postgres_repository.py`
- Test: `apps/api/tests/test_api_security_and_lifecycle.py`

**Consumes:** Tasks 3–5 contracts, repository outcome names, and RPC result shape.

**Produces:** v2-only HTTP ingestion with explicit safe state errors and bounded post-commit outbox publication.

- [ ] **Step 1: Execute the endpoint-compatibility gate before cutover.**

Run the two exact `rg` commands in the Endpoint-Compatibility Gate section. Record their output in the Task 7 ADR: tests, schemas, generated artifacts, and the plan are excluded; current runtime code has no route call or `ApiClient` method for event batch ingestion, so no runtime caller can send a v1 browser-event body. If the result differs, stop and report `DESIGN BLOCKED` before changing `main.py`.

- [ ] **Step 2: Run the API/PostgREST tests and confirm their red state persists.**

Run: `.venv\\Scripts\\python.exe -m pytest apps/api/tests/test_postgres_repository.py apps/api/tests/test_api_security_and_lifecycle.py -q`

Expected: FAIL until FastAPI accepts `EventBatchV2`, maps outcomes, and attempts publication.

- [ ] **Step 3: Update PostgREST error and outcome handling.**

Change `_request` to decode a PostgREST error only when needed for unexpected infrastructure failures; never include upstream body text in API errors. `ingest` must accept `list[BrowserEventV2]`, add an event fingerprint server-side, call the unchanged RPC route, and map only declared RPC outcomes. Any malformed/out-of-contract RPC result remains `503 database_unavailable`.

- [ ] **Step 4: Make `/api/v1/events/batch` v2-only.**

Use `payload: EventBatchV2` and `event_batch_v2_request_hash(payload)`. Remove all endpoint checks that refer to title/context/origin, because v2 `extra='forbid'` makes them unreachable. Preserve request-size, event-count, JWT, rate-limit, idempotency-key, future/past timestamp, conflict, and in-progress behavior.

Map repository results deterministically:

```python
safe_outcomes = {
    "device_inactive": (409, "device_revoked", "The device is unavailable."),
    "consent_inactive": (409, "consent_inactive", "Monitoring consent is unavailable."),
    "session_not_recording": (409, "session_not_recording", "The session is not recording."),
    "policy_mismatch": (409, "capture_policy_mismatch", "The capture policy does not match the session."),
}
```

Do not expose owner existence, consent IDs, database details, raw values, or request hashes.

- [ ] **Step 5: Add a bounded post-commit publisher attempt.**

Immediately after a created/completed `202` ingestion result is validated, call `repository.publish_outbox(settings.outbox_max_batch)` once in a `try/except ApiError`. Ignore only that publisher error and return the already-committed safe ingestion response. Do not use the internal token, make an HTTP self-call, create a background worker, or log event data. The existing protected internal publisher remains available for future operational recovery.

- [ ] **Step 6: Run focused API/PostgREST tests and verify green.**

Run: `.venv\\Scripts\\python.exe -m pytest apps/api/tests/test_postgres_repository.py apps/api/tests/test_api_security_and_lifecycle.py -q`

Expected: PASS, including publisher-failure-does-not-undo-202 coverage.

- [ ] **Step 7: Do not commit.**

### Task 7: Add the ADR and complete cross-layer regression verification

**Files:**

- Create: `docs/adr/0006-m4-navigation-event-v2-privacy-boundary.md`
- Modify: `docs/architecture/milestone-2-event-contract-matrix.md`
- Modify: `schemas/README.md`
- Test: all contract, API, and SQL suites above

**Consumes:** Final behavior from Tasks 1–6.

**Produces:** Permanent rationale and verified handoff evidence without scope expansion.

- [ ] **Step 1: Write documentation assertions/review checklist before editing docs.**

Confirm the ADR states: v1 is immutable historical contract; v2 is navigation-only; `page_domain` is the only browsing-location field; the browser never reaches the internal publisher; typed outcomes are safe and do not expose ownership details; and queue messages are references only.

Confirm the architecture matrix distinguishes v1’s historical redacted fields from v2’s prohibited fields and does not imply title/DOM capture is enabled.

- [ ] **Step 2: Write ADR 0006.**

Use sections `Status`, `Context`, `Decision`, `Consequences`, and `Rollback`. Mark status `Accepted for Milestone 4-A`. State that rollback requires a later migration and must not reinterpret v1 data.

- [ ] **Step 3: Update contract documentation.**

Document both schema IDs, additive TypeScript exports, v2’s exact fields, and the fact that `POST /api/v1/events/batch` now accepts v2 only. Explicitly list URL/origin/host/port/path/query/fragment/title/DOM/text/accessibility/tab/document/process/qualifier fields as v2-prohibited.

- [ ] **Step 4: Run all focused regression suites.**

Run: `pnpm contracts:check`

Expected: PASS.

Run: `.venv\\Scripts\\python.exe -m pytest apps/api/tests/test_event_contract.py apps/api/tests/test_event_idempotency.py apps/api/tests/test_api_security_and_lifecycle.py apps/api/tests/test_postgres_repository.py apps/api/tests/test_migration_safety.py -q`

Expected: PASS.

- [ ] **Step 5: Run repository-wide verification.**

Run, in this order:

```powershell
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:contract
pnpm build
pnpm secret:scan
pnpm supabase:migration-check
.venv\Scripts\python.exe -m ruff check .
.venv\Scripts\python.exe -m mypy apps/api/src apps/worker/src packages/python-shared/src
.venv\Scripts\python.exe -m pytest
.venv\Scripts\python.exe scripts/validate-skills.py
.venv\Scripts\python.exe -m unittest tests/test_validate_skills.py -v
supabase db reset
pnpm supabase:test
```

Expected: every available command passes. If local Supabase cannot start, report the unavailable Docker/CLI prerequisite separately; all non-Supabase checks must still be run.

- [ ] **Step 6: Perform the final privacy/security review.**

Verify by code search and tests that no v2 schema/model/SQL/queue body contains raw URL/origin/host/port/path/query/fragment/title/DOM/text/accessibility/tab/document/process/qualifier fields; no API log serializes payloads; only `service_role` invokes privileged RPCs; v2 queue body has exactly two keys; and no extension file or manifest was modified.

- [ ] **Step 7: Do not commit, push, or merge.**

## Requirement Coverage Review

| Approved requirement                                                      | Plan task(s)                         |
| ------------------------------------------------------------------------- | ------------------------------------ |
| Canonical v2, strict field prohibition, v1 preservation                   | 1, 2, 4, 7                           |
| UUID client-event identity, positive sequences, top-level transition enum | 1, 2, 3, 4, 5                        |
| Runtime v1 caller compatibility gate before endpoint cutover              | Endpoint-Compatibility Gate, 6       |
| Forward-only v2 columns and v1/v2 database separation                     | 5                                    |
| JWT/device/session/consent/policy/idempotency/dedupe gate                 | 3, 4, 5, 6                           |
| Transactional browser event/outbox/idempotency                            | 5                                    |
| Version-2 reference-only outbox payload                                   | 5, 6                                 |
| Small trusted bounded publisher invocation                                | 3, 6                                 |
| Pause/complete server semantics                                           | 5                                    |
| Full contract/API/pgTAP test coverage                                     | 1–6                                  |
| ADR and documentation                                                     | 7                                    |
| No extension capture or forbidden work                                    | Global Constraints, 5–7 verification |

## Security Findings to Re-verify During Execution

- **High — v1 content-field reuse.** Threat: v2 accepts title/context/origin fields. Affected component: schemas, Pydantic, RPC. Evidence: current v1 contains those optional fields. Exploit conditions: reuse of the old event model or a permissive JSON payload. Impact: collection beyond approved navigation metadata. Remediation: separate v2 schemas/models and v2 database shape check. Required test: every prohibited field is rejected by TS, Pydantic, API, and SQL. Residual risk: v1 remains historical by design and must never be routed to the v2 endpoint.

- **High — expected authorization failure masked as infrastructure error.** Threat: the extension cannot stop after device revocation, consent withdrawal, session state change, or policy mismatch. Affected component: RPC/PostgREST/API outcome mapping. Evidence: current `PostgrestRepository._request` maps all database errors to `503`. Exploit conditions: state invalidates between buffering and delivery. Impact: unsafe retries and delayed capture shutdown. Remediation: typed RPC results and fixed safe HTTP mappings. Required test: one endpoint test per typed state outcome. Residual risk: remote revocation remains discoverable only at reconciliation or ingestion time until a future extension control mechanism exists.

- **Medium — queue metadata expansion.** Threat: browsing metadata enters PGMQ. Affected component: outbox publisher. Evidence: queue uses JSON and could carry added fields without a structural guard. Exploit conditions: publisher payload is changed during v2 work. Impact: unnecessary durable dissemination of browsing data. Remediation: preserve reference-only builder and test exact JSON equality for version 2. Required test: pgTAP queue message has exactly `browser_event_id` and `contract_version`. Residual risk: consumers are deferred and must preserve this contract later.

- **Medium — post-commit publisher failure misreported.** Threat: a successful ingestion returns failure after its transaction commits, encouraging duplicate client behavior and leaking internal state. Affected component: FastAPI event route. Evidence: M4-A adds bounded publishing after the transaction. Exploit conditions: PGMQ/DB publisher temporarily unavailable. Impact: confused delivery semantics. Remediation: best-effort publisher call that never overrides committed `202`; outbox remains durable. Required test: injected publisher failure still returns the accepted response. Residual risk: delayed publication until the next bounded invocation.
