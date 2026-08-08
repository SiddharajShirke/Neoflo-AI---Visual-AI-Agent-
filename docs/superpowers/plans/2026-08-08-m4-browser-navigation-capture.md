# Milestone 4-B — Privacy-Safe Browser Navigation Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Build the domain-only, durable navigation pipeline that sends immutable BrowserEventV2 batches through the M4-A API gate.

**Architecture:** The MV3 worker owns one committed-navigation listener. A generation CaptureGate and scoped PSL normalizer minimize Chrome input before a strict IndexedDB repository persists v2 events. A lifecycle coordinator drains those events before M3 pause/complete mutations.

**Tech Stack:** WXT, Manifest V3, TypeScript, Vitest, fake-indexeddb, Chrome webNavigation/alarms, IndexedDB, Web Crypto, canonical contracts, pinned tldts.

## Global constraints

- M4-B only: do not alter M4-A backend/database, Browser Event v1, or internal outbox publishing.
- Add exactly webNavigation to storage and alarms. Preserve existing exact API/Supabase hosts and incognito not_allowed.
- No content scripts, site wildcard hosts, tabs, activeTab, history, cookies, scripting, identity, capture permissions, or browser/page-content capture.
- Persist only BrowserEventV2 fields. URL, hostname, origin, port, path, query, fragment, credentials, title, DOM/text, browser IDs, and qualifiers are prohibited.
- Strict navigation allowlists are the privacy boundary; generic M3 denylist logic is not.
- Protected policy is local, first-party-curated, versioned, deterministic, and non-exhaustive. Runtime data has no evidence URLs or network classification.
- Every task is RED, GREEN, REFACTOR. Do not combine unrelated tasks.
- No commit, push, merge, rebase, or repository-wide format write without separate authorization.
- Target-format changed paths. A dependency change requires a pnpm-lock formatting check. Clean Linux CI is authoritative.

## Shared file map

| Paths                                                                                                                      | Responsibility                                       |
| -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| apps/extension/src/manifest.ts and tests/manifest.test.ts                                                                  | Exact permission boundary.                           |
| src/privacy/domain-normalizer.ts and tests/navigation-domain-normalizer.test.ts                                            | Transient URL parsing and PSL derivation.            |
| src/privacy/protected-domains-v1.json and protected-domain-policy.ts                                                       | Static approved rules and strict matcher.            |
| src/navigation/capture-gate.ts and navigation-repository.ts                                                                | Authority, leases, strict writes, sequence, batches. |
| src/navigation/event-factory.ts, committed-navigation-handler.ts, duplicate-cache.ts                                       | Capture path only.                                   |
| src/navigation/batch-builder.ts, canonical-request.ts, delivery.ts, retry.ts, alarm-scheduler.ts, lifecycle-coordinator.ts | Delivery and ordering.                               |
| src/navigation/metrics.ts and safe-log.ts                                                                                  | Safe local observability.                            |
| src/api/client.ts, entrypoints/background.ts, core/orchestrator.ts, state-machine.ts, indicator.ts                         | API and worker lifecycle integration.                |
| popup/main.ts and popup/view-model.ts                                                                                      | Safe status only.                                    |
| scripts/check-extension-manifest.mjs and check-extension-bundle-privacy.mjs                                                | Built artifact validation.                           |
| docs/adr/0007-m4-browser-navigation-capture.md                                                                             | Policy evidence, PSL provenance, security decision.  |

```ts
type NavigationDeliveryState = 'unbatched' | 'batched';
type NavigationBatchState = 'pending' | 'delivering' | 'failed_permanent' | 'blocked_auth';

interface CaptureContext {
  generation: number;
  deviceId: string;
  sessionId: string;
  capturePolicyVersion: 'm4-navigation-v1';
}

interface NavigationEventRecord extends BrowserEventV2 {
  delivery_state: NavigationDeliveryState;
  batch_id?: string;
  created_at: string;
}

interface NavigationBatchRecord {
  batch_id: string;
  idempotency_key: string;
  device_id: string;
  session_id: string;
  event_ids: readonly string[];
  canonical_request_hash: string;
  retry_count: number;
  next_retry_at: string;
  delivery_state: NavigationBatchState;
  created_at: string;
  updated_at: string;
}
```

### Task 1: Manifest regression and webNavigation permission

**Files:** Modify apps/extension/src/manifest.ts; modify apps/extension/tests/manifest.test.ts.

- [ ] **RED:** Add an exact source-manifest assertion for storage, alarms, webNavigation; preserve exact hosts/incognito; reject tabs, activeTab, history, cookies, scripting, identity, capture APIs, wildcard hosts, and content_scripts.
- [ ] **Run:** pnpm.cmd --filter @visual-ai/extension test -- manifest.test.ts. Expect failure because webNavigation is absent and forbidden.
- [ ] **GREEN:** Add only webNavigation to the permission tuple and remove only its forbidden regression assertion.
- [ ] **Run:** Repeat the focused test. Expect pass.
- [ ] **REFACTOR:** Retain one exact-set assertion and individual forbidden regressions; target-format both files.

### Task 2: PSL dependency and domain normalizer

**Files:** Modify package.json and pnpm-lock.yaml; create src/privacy/domain-normalizer.ts; create tests/navigation-domain-normalizer.test.ts.

```ts
type NormalizeResult =
  | { kind: 'accepted'; pageDomain: string }
  | { kind: 'ignored'; reason: 'non_http' | 'invalid_domain' };
function normalizeNavigationUrl(rawUrl: string): NormalizeResult;
```

- [ ] **RED:** Before production normalizer code, install the pinned dependency and write a dependency-contract test that imports its exact installed API, proves the selected parser call returns example.co.uk for a.b.example.co.uk, returns no registrable domain for co.uk, localhost, and IP literals, and proves allowPrivateDomains false behavior with a private-suffix fixture. Add navigation tests for www.example.com to example.com, uppercase normalization, forbidden schemes, credentials, .local, malformed URLs, and no path/query/fragment output.
- [ ] **Run:** pnpm.cmd --filter @visual-ai/extension test -- navigation-domain-normalizer.test.ts. Expect missing module.
- [ ] **GREEN:** Use only the API/options proven by the dependency-contract test. Parse URL only in this function; reject listed cases; use allowPrivateDomains false; return only accepted pageDomain or safe reason.
- [ ] **Run:** Repeat focused test. Expect pass.
- [ ] **REFACTOR:** Add IDN cases: accept output only when current BrowserEventV2 validator accepts it; reject unsupported IDN-TLD output. Run target formatting and pnpm-lock formatting check.

### Task 3: protected-domains-v1 artifact and validator

**Files:** Create src/privacy/protected-domains-v1.json, src/privacy/protected-domain-policy.ts, tests/protected-domain-policy.test.ts, docs/adr/0007-m4-browser-navigation-capture.md.

```ts
type ProtectedCategory = 'authentication_account_recovery' | 'payments_financial' | 'health';
type ProtectedMatchType = 'exact' | 'suffix';
function loadProtectedDomainPolicy(value: unknown): ProtectedDomainPolicy;
```

- [ ] **RED:** Test approved metadata and all six rules. Reject unknown category/match type, missing provenance, non-lowercase/malformed/URL-like domain, evidence URL in runtime artifact, and duplicate domain/match-type pair.
- [ ] **Run:** pnpm.cmd --filter @visual-ai/extension test -- protected-domain-policy.test.ts. Expect missing artifact/validator.
- [ ] **GREEN:** Add exact approved JSON and closed-key validator. Reject duplicates, rather than selecting by list order.
- [ ] **Run:** Repeat focused test. Expect valid artifact and all invalid variants pass their rejection assertions.
- [ ] **REFACTOR:** ADR records evidence/PSL provenance outside JSON, required policy statement, update owner, and residual risk.

### Task 4: User/protected matching

**Files:** Modify persistence/domain-rules.ts and privacy/protected-domain-policy.ts; modify domain-rules.test.ts and protected-domain-policy.test.ts.

```ts
function matchesDomainRule(hostname: string, rule: string): boolean;
function matchProtectedHostname(hostname: string): ProtectedCategory | null;
```

- [ ] **RED:** Test exact and dot-boundary suffix matching; reject notexample.com and example.com.evil.test; test Google exact and Bank of America suffix rules; prove user rules add but cannot override system protection.
- [ ] **Run:** Run both focused test files. Expect absent matcher exports.
- [ ] **GREEN:** Implement one normalized dot-boundary matcher. Evaluate protected rule first so it produces only ignored_protected_domain. Do not persist observed hostname.
- [ ] **Run:** Repeat tests. Expect pass.
- [ ] **REFACTOR:** Preserve current DomainRuleRepository add/list/remove semantics.

### Task 5: CaptureGate

**Files:** Create src/navigation/capture-gate.ts and tests/navigation-capture-gate.test.ts.

```ts
interface CaptureLease {
  readonly context: CaptureContext;
  release(): void;
}
class CaptureGate {
  open(context: Omit<CaptureContext, 'generation'>): CaptureContext;
  close(): Promise<void>;
  acquire(): CaptureLease | null;
  isCurrent(context: CaptureContext): boolean;
}
```

- [ ] **RED:** Test initial closure; no lease in READY, SIGNED_OUT, STARTING, PAUSING, PAUSED, RESUMING, STOPPING, STOPPED, or SYNC_ERROR; authenticated reconciled recording opens; transient offline health with retained recording authority opens.
- [ ] **Run:** pnpm.cmd --filter @visual-ai/extension test -- navigation-capture-gate.test.ts. Expect missing module.
- [ ] **GREEN:** Implement immutable context snapshots, monotonic generation, lease count, and close resolution after leases release.
- [ ] **Run:** Repeat focused test. Expect pass.
- [ ] **REFACTOR:** Gate receives already-authoritative context and does not interpret remote state.

### Task 6: Generation and in-flight lease barrier

**Files:** Modify capture-gate.ts and navigation-capture-gate.test.ts.

```ts
closeAndDrain(): Promise<CaptureContext | null>;
```

- [ ] **RED:** Use deferred promises to prove close invalidates a handler when closed generation wins and waits when a pre-close lease owns append.
- [ ] **Run:** Run navigation-capture-gate.test.ts. Expect absent close/drain behavior.
- [ ] **GREEN:** Add synchronously invalidating closeAndDrain that exposes closed generation for durable repository persistence.
- [ ] **Run:** Repeat focused test. Expect deterministic race behavior.
- [ ] **REFACTOR:** Release is idempotent and cannot underflow.

### Task 7: IndexedDB v2 -> v3 migration

**Files:** Modify persistence/database.ts and tests/persistence.test.ts.

```ts
const DATABASE_VERSION = 3;
const NAVIGATION_STORES = ['navigation_event_buffer', 'navigation_batches'] as const;
```

- [ ] **RED:** Build v2 fixture with all M3 stores/records; upgrade and assert all survive plus new stores/key paths.
- [ ] **Run:** pnpm.cmd --filter @visual-ai/extension test -- persistence.test.ts. Expect navigation stores absent.
- [ ] **GREEN:** Add forward v3 branch creating only missing navigation stores; never delete/recreate M3 stores.
- [ ] **Run:** Repeat focused test. Expect preservation pass.
- [ ] **REFACTOR:** Centralize typed store/key-path declarations.

### Task 8: Strict navigation repository

**Files:** Create navigation/navigation-repository.ts and tests/navigation-repository.test.ts; modify persistence/database.ts.

```ts
class NavigationRepository {
  append(
    event: BrowserEventV2,
    context: CaptureContext
  ): Promise<'appended' | 'closed' | 'capacity_exceeded'>;
  listUnbatched(): Promise<readonly NavigationEventRecord[]>;
  purgeSession(sessionId: string): Promise<void>;
}
```

- [ ] **RED:** Attempt writes with URL, hostname, title, tab/document ID, arbitrary metadata, and unknown keys; assert rejection before IndexedDB write. Assert valid row has only allowed keys.
- [ ] **Run:** Run navigation-repository.test.ts. Expect missing repository.
- [ ] **GREEN:** Add typed transactions and exact own-key validation; navigation writes never use generic ControlPlaneDatabase.put.
- [ ] **Run:** Repeat focused test. Expect valid write/prohibited rejection.
- [ ] **REFACTOR:** Keep low-level transaction helpers private and M3 generic persistence unchanged.

### Task 9: Atomic sequence allocator

**Files:** Modify navigation-repository.ts and navigation-repository.test.ts.

```ts
appendDraft(
  draft: Omit<BrowserEventV2, "sequence_number">,
  context: CaptureContext
): Promise<"appended" | "closed" | "capacity_exceeded">;
```

- [ ] **RED:** Concurrent append test proves sequence starts at 1, is unique/monotonic, and is never reused after repository restart.
- [ ] **Run:** Run allocator cases. Expect duplicate/non-transactional sequence behavior.
- [ ] **GREEN:** One transaction validates durable gate generation/open/session, allocates/increments sequence, and appends.
- [ ] **Run:** Repeat focused test. Expect pass.
- [ ] **REFACTOR:** Store sequence only in exact navigation coordination state.

### Task 10: Navigation event factory

**Files:** Create navigation/event-factory.ts and tests/navigation-event-factory.test.ts.

```ts
function createNavigationEvent(input: {
  pageDomain: string;
  transitionType: BrowserEventV2['transition_type'];
  occurredAt: Date;
}): Omit<BrowserEventV2, 'sequence_number'>;
```

- [ ] **RED:** Assert UUID, navigation literal, ISO timestamp, m4-navigation-v1, valid transition, and absence of prohibited properties.
- [ ] **Run:** Run navigation-event-factory.test.ts. Expect missing module.
- [ ] **GREEN:** Construct only permitted fields and validate supplied-positive-sequence result through isBrowserEventV2.
- [ ] **Run:** Repeat focused test. Expect pass.
- [ ] **REFACTOR:** Factory input has no URL/hostname/title/tab/qualifier/metadata parameter.

### Task 11: onCommitted handler

**Files:** Create navigation/committed-navigation-handler.ts and tests/navigation-committed-handler.test.ts.

```ts
interface CommittedNavigationDetails {
  frameId: number;
  url: string;
  transitionType: string;
  documentId?: string;
  tabId?: number;
  timeStamp?: number;
}
function handleCommittedNavigation(details: CommittedNavigationDetails): Promise<void>;
```

- [ ] **RED:** Assert closed gate returns before normalizer; subframe ignored; valid HTTP(S) invokes normalizer/factory/repository once; forbidden/malformed schemes create nothing; protected input creates no event, repository row, batch, or API call and increments only ignored_protected_domain.
- [ ] **Run:** Run navigation-committed-handler.test.ts. Expect missing handler.
- [ ] **GREEN:** Implement acquire -> frame check -> scoped normalizer/filter -> gate recheck -> factory/repository. Do not log/message/retain details.
- [ ] **Run:** Repeat focused test. Expect pass.
- [ ] **REFACTOR:** Keep listener adapter separate for dependency injection.

### Task 12: Duplicate suppression cache

**Files:** Create navigation/duplicate-cache.ts and tests/navigation-duplicate-cache.test.ts; modify committed-navigation-handler.ts.

```ts
class NavigationDuplicateCache {
  seen(key: string, nowMs: number): boolean;
}
```

- [ ] **RED:** Same transient key within TTL ignores; expiry accepts; capacity eviction deterministic; fresh worker cache empty; no cache key reaches repository/metrics/log.
- [ ] **Run:** Run duplicate-cache and handler tests. Expect duplicate append.
- [ ] **GREEN:** Add bounded in-memory cache using transient session/document or tab/timestamp key after gate/frame check and before event factory.
- [ ] **Run:** Repeat focused tests. Expect one event/no persisted browser identifier.
- [ ] **REFACTOR:** Document optimization-only and add no store.

### Task 13: Capacity accounting and fail-closed behavior

**Files:** Modify navigation-repository.ts, navigation-repository.test.ts, navigation-capture-gate.test.ts.

```ts
const MAX_PENDING_EVENTS = 1_000;
const MAX_PENDING_EVENT_BYTES = 1_048_576;
```

- [ ] **RED:** Fill each cap independently; next append is capacity_exceeded, old rows remain, candidate absent, counters exact, caller closes gate into sync error.
- [ ] **Run:** Run capacity cases. Expect append past bounds.
- [ ] **GREEN:** Estimate only candidate record, atomically compare/update typed counters, reject without write.
- [ ] **Run:** Repeat tests. Expect both caps/no eviction pass.
- [ ] **REFACTOR:** Full counter recomputation is explicit recovery only.

### Task 14: Immutable batch creation

**Files:** Create navigation/batch-builder.ts and tests/navigation-batch-builder.test.ts; modify navigation-repository.ts.

```ts
function formNextBatch(context: CaptureContext): Promise<NavigationBatchRecord | null>;
```

- [ ] **RED:** Seed 21 ordered rows; first batch holds 20 ordered IDs, exactly those rows become batched, later event cannot join/change membership.
- [ ] **Run:** Run navigation-batch-builder.test.ts. Expect missing implementation.
- [ ] **GREEN:** Atomically assign UUID, idempotency key, ordered IDs, pending state, retry zero, timestamps, and event batch_id.
- [ ] **Run:** Repeat focused test. Expect pass.
- [ ] **REFACTOR:** Enforce one active/draining session before selection.

### Task 15: Canonical request hash

**Files:** Create navigation/canonical-request.ts and tests/navigation-canonical-request.test.ts; modify batch-builder.ts.

```ts
function buildCanonicalBatchRequest(
  batch: NavigationBatchRecord,
  events: readonly NavigationEventRecord[]
): BrowserEventBatchV2;
async function sha256CanonicalBatch(request: BrowserEventBatchV2): Promise<string>;
```

- [ ] **RED:** Same ordered data has same body/hash; order/allowed-field change changes hash; body has only device_id, session_id, v2 events.
- [ ] **Run:** Run navigation-canonical-request.test.ts. Expect missing functions.
- [ ] **GREEN:** Stable-serialize permitted fields, hash UTF-8 with Web Crypto, persist hash at batch formation.
- [ ] **Run:** Repeat focused test. Expect pass.
- [ ] **REFACTOR:** Every send rebuilds/verifies hash; mismatch sends nothing and becomes sync error.

### Task 16: ApiClient.ingestBrowserEventBatch

**Files:** Modify api/client.ts and tests/api-client.test.ts.

```ts
ingestBrowserEventBatch(
  payload: BrowserEventBatchV2,
  idempotencyKey: string
): Promise<EventIngestionResponse>;
```

- [ ] **RED:** v1/prohibited payload rejects locally; valid v2 POSTs only /api/v1/events/batch with stable Idempotency-Key/send-time auth; response uses isEventIngestionResponse.
- [ ] **Run:** Run api-client.test.ts. Expect method-not-found.
- [ ] **GREEN:** Add only fixed typed method using existing private request/refresh behavior.
- [ ] **Run:** Repeat focused test. Expect pass.
- [ ] **REFACTOR:** Preserve ApiClientError status/code/retry-after; no generic fetch/direct Supabase.

### Task 17: Event batch delivery engine

**Files:** Create navigation/delivery.ts and tests/navigation-delivery.test.ts; modify navigation-repository.ts.

```ts
class NavigationDeliveryEngine {
  deliverDue(now?: Date): Promise<void>;
}
```

- [ ] **RED:** One concurrent loop; claim persists delivering before API; success removes only after accepted_count + duplicate_count equals member count and atomically projects sync state; mismatch deletes nothing.
- [ ] **Run:** Run navigation-delivery.test.ts. Expect missing engine.
- [ ] **GREEN:** Implement loop guard, claim/ack transactions, hash verification, fixed ApiClient dispatch.
- [ ] **Run:** Repeat test. Expect projection-before-deletion pass.
- [ ] **REFACTOR:** Navigation batches never become M3 PendingMutation.

### Task 18: Retry/backoff/Retry-After

**Files:** Create navigation/retry.ts and tests/navigation-retry.test.ts; modify navigation/delivery.ts and navigation-delivery.test.ts.

```ts
function navigationRetryDelayMs(totalSends: number, jitter: number): number;
function isNavigationRetryable(status: number | undefined): boolean;
```

- [ ] **RED:** undefined/status 0, 408, 425, 429, 5xx retry; 400/403/404/409/422 do not; first retry ceiling five seconds; later and Retry-After cap five minutes.
- [ ] **Run:** Run retry/delivery tests. Expect status-0/delay mapping failure.
- [ ] **GREEN:** Reuse M3 retry primitives where correct; translate total send count so first retry uses five-second base; persist pending next_retry_at.
- [ ] **Run:** Repeat focused tests. Expect pass.
- [ ] **REFACTOR:** Jitter injection stays deterministic; headers/bodies are not logged.

### Task 19: Exactly-seven-total-send accounting

**Files:** Modify navigation/delivery.ts and navigation-delivery.test.ts.

- [ ] **RED:** Seven transport failures cause exactly seven API calls, including first; retry_count is one through seven before calls; eighth delivery makes no call and preserves failed_permanent rows.
- [ ] **Run:** Run the named seven-send test. Expect off-by-one/direct-path failure.
- [ ] **GREEN:** Claim increments retry_count before every HTTP attempt and retries only while count remains below seven.
- [ ] **Run:** Repeat test. Expect exactly seven calls.
- [ ] **REFACTOR:** Keep named regression stating first send counts.

### Task 20: Stale delivering recovery

**Files:** Modify navigation/delivery.ts and navigation-delivery.test.ts.

- [ ] **RED:** Seed delivering batch; fresh engine restores pending without changing IDs/hash/key/retry count and delivers once.
- [ ] **Run:** Run stale-delivery test. Expect permanent delivering state.
- [ ] **GREEN:** Recover unresolved delivering before due selection; never reset identity/count.
- [ ] **Run:** Repeat test. Expect pass.
- [ ] **REFACTOR:** Repeated recovery is idempotent.

### Task 21: Alarm scheduling

**Files:** Create navigation/alarm-scheduler.ts and tests/navigation-alarm-scheduler.test.ts; modify entrypoints/background.ts.

```ts
const NAVIGATION_ALARM_NAME = 'visual-ai-navigation-v1';
class NavigationAlarmScheduler {
  schedule(when: Date): Promise<void>;
  onAlarm(name: string): Promise<void>;
}
```

- [ ] **RED:** Earliest due schedules named one-shot; unrelated alarm ignored; alarm/manual/startup triggers do not overlap; absent alarm recreated on startup.
- [ ] **Run:** Run navigation-alarm-scheduler.test.ts. Expect missing scheduler.
- [ ] **GREEN:** Add dedicated Chrome alarms scheduler and background dispatch for M3/navigation names.
- [ ] **Run:** Repeat test. Expect pass.
- [ ] **REFACTOR:** No setInterval; document thirty seconds as lower-bound.

### Task 22: Startup recovery

**Files:** Modify entrypoints/background.ts and core/orchestrator.ts; create tests/navigation-startup-recovery.test.ts.

- [ ] **RED:** Stores/counters restore, delivering recovers, pending schedules, gate stays closed until authenticated reconciliation confirms recording/m4 policy; no auth leaves closed.
- [ ] **Run:** Run navigation-startup-recovery.test.ts. Expect M3-only restore.
- [ ] **GREEN:** Order restore as store recovery -> auth -> reconcile -> gate open -> schedule.
- [ ] **Run:** Repeat test. Expect pass.
- [ ] **REFACTOR:** Keep this order in one worker startup function.

### Task 23: Typed M4-A outcome handling

**Files:** Modify navigation/delivery.ts and navigation-delivery.test.ts.

```ts
type NavigationAuthorityOutcome =
  | 'device_revoked'
  | 'consent_inactive'
  | 'session_not_recording'
  | 'capture_policy_mismatch';
```

- [ ] **RED:** Each typed 409 closes gate immediately, does not generic-retry, and invokes matching hook once.
- [ ] **Run:** Run typed-outcome cases. Expect generic permanent handling.
- [ ] **GREEN:** Decode closed safe-code union and route to background/lifecycle hooks.
- [ ] **Run:** Repeat test. Expect pass.
- [ ] **REFACTOR:** Unknown 409 remains permanent sync error with rows retained.

### Task 24: Auth, consent, device, policy shutdown

**Files:** Modify navigation/delivery.ts, navigation-repository.ts, entrypoints/background.ts; create tests/navigation-shutdown.test.ts.

```ts
async function invalidateNavigationSession(
  reason:
    | 'authentication_required'
    | 'device_revoked'
    | 'consent_inactive'
    | 'capture_policy_mismatch'
): Promise<void>;
```

- [ ] **RED:** Final 401 closes gate before centralized auth sign-out, purges session rows/batches, blocks capture, logs no body. Repeat for device, consent, policy, and local consent withdrawal.
- [ ] **Run:** Run navigation-shutdown.test.ts. Expect incomplete shutdown.
- [ ] **GREEN:** One background-owned close/purge/safe-state function delegates auth/consent control-plane work to existing M3 boundaries.
- [ ] **Run:** Repeat test. Expect pass.
- [ ] **REFACTOR:** Delivery never duplicates sign-out logic.

### Task 25: session_not_recording reconciliation

**Files:** Modify navigation/delivery.ts, core/orchestrator.ts, navigation-delivery.test.ts, navigation-startup-recovery.test.ts.

- [ ] **RED:** One reconciliation: paused/completed/cancelled purges and projects remote state; recording preserves batch in sync error for explicit retry; no automatic loop.
- [ ] **Run:** Run reconciliation cases. Expect generic 409 path.
- [ ] **GREEN:** Call typed getSession/orchestrator reconcile once and apply exact purge/preserve rules.
- [ ] **Run:** Repeat test. Expect pass.
- [ ] **REFACTOR:** Log remote status only as safe enum.

### Task 26: Pause event-drain barrier

**Files:** Create navigation/lifecycle-coordinator.ts and tests/navigation-lifecycle-coordinator.test.ts; modify core/orchestrator.ts and entrypoints/background.ts.

- [ ] **RED:** Deferred lease test proves close -> lease drain -> event acknowledgement -> remote pause -> PAUSED. Non-authority permanent failure sends no pause and stays sync error.
- [ ] **Run:** Run lifecycle-coordinator test. Expect current direct pause.
- [ ] **GREEN:** Persist closed generation/lifecycle intent and defer M3 pause mutation creation until navigation drain.
- [ ] **Run:** Repeat test. Expect ordering pass.
- [ ] **REFACTOR:** Existing M3 engine transmits the mutation only after coordinator authorization.

### Task 27: Stop event-drain barrier

**Files:** Modify lifecycle-coordinator.ts, navigation-lifecycle-coordinator.test.ts, core/orchestrator.ts.

- [ ] **RED:** Close gate, block race append, acknowledge events before complete, and block complete on permanent non-authority sync failure.
- [ ] **Run:** Run stop case. Expect direct complete.
- [ ] **GREEN:** Add complete lifecycle intent and reject new session while stop drain unresolved.
- [ ] **Run:** Repeat test. Expect pass.
- [ ] **REFACTOR:** Share drain primitive but keep pause/complete projections distinct.

### Task 28: Offline lifecycle dependency ordering

**Files:** Modify lifecycle-coordinator.ts, navigation-repository.ts, navigation-lifecycle-coordinator.test.ts, navigation-startup-recovery.test.ts.

- [ ] **RED:** Offline pause/stop closes gate and persists typed intent, creates no M3 mutation, restart restores intent, event acknowledgement precedes exactly one control mutation.
- [ ] **Run:** Run offline ordering cases. Expect queue race.
- [ ] **GREEN:** Store intent only in exact navigation coordination and authorize M3 mutation after drain.
- [ ] **Run:** Repeat test. Expect restart-safe order.
- [ ] **REFACTOR:** Reject conflicting second intent rather than replacing it.

### Task 29: Start/resume capture enablement

**Files:** Modify core/orchestrator.ts, entrypoints/background.ts, tests/orchestrator.test.ts, navigation-startup-recovery.test.ts.

- [ ] **RED:** Start/resume keeps gate closed during request; only remote recording plus m4 policy opens; remote error, old/missing policy, and local optimistic recording do not.
- [ ] **Run:** Run focused orchestrator/startup tests. Expect no gate integration.
- [ ] **GREEN:** Add explicit post-success reconciliation and safe gate-open call.
- [ ] **Run:** Repeat tests. Expect pass.
- [ ] **REFACTOR:** Preserve non-navigation M3 lifecycle behavior.

### Task 30: Local aggregate metrics

**Files:** Create navigation/metrics.ts and tests/navigation-metrics.test.ts; modify repository, handler, batch builder, delivery.

- [ ] **RED:** Required duration, batch/retry/queue/byte/age and ignore counters serialize without domain, URL, event/browser ID, body, or per-event samples.
- [ ] **Run:** Run navigation-metrics.test.ts. Expect missing aggregate metric record.
- [ ] **GREEN:** Add bounded named counters/duration buckets in exact metric record and wire local operations separately from HTTP.
- [ ] **Run:** Repeat test. Expect pass.
- [ ] **REFACTOR:** No telemetry upload/unbounded sample store.

### Task 31: Safe logging

**Files:** Create navigation/safe-log.ts and tests/navigation-safe-log.test.ts; modify new navigation modules/background.

```ts
type SafeNavigationLog = {
  operation: string;
  eventCount?: number;
  retryCount?: number;
  errorCode?: string;
  requestId?: string;
  queueDepth?: number;
};
function logNavigation(event: SafeNavigationLog): void;
```

- [ ] **RED:** URL, hostname, domain, token, Authorization, body, details, and arbitrary Error logging reject; count/code succeeds.
- [ ] **Run:** Run navigation-safe-log.test.ts. Expect missing/unsafe logger.
- [ ] **GREEN:** Exact-key logger replaces new navigation console calls only.
- [ ] **Run:** Repeat test. Expect pass.
- [ ] **REFACTOR:** Use synthetic values and content-free output.

### Task 32: Popup/indicator sync-state integration

**Files:** Modify core/indicator.ts, popup/view-model.ts, popup/main.ts, tests/popup-view-model.test.ts, tests/runtime-message.test.ts.

```ts
interface SafeNavigationSyncView {
  pendingCount: number;
  syncState: 'healthy' | 'offline_buffering' | 'sync_error';
}
```

- [ ] **RED:** UI receives only state/count and exact policy statement; domains/events/URLs rejected in messages; no system-rule remove action.
- [ ] **Run:** Run popup/runtime-message tests. Expect missing safe view/copy.
- [ ] **GREEN:** Add fixed safe view data/indicator mapping; preserve user exclusions only.
- [ ] **Run:** Repeat tests. Expect pass.
- [ ] **REFACTOR:** Popup derives typed worker state and never reads navigation stores.

### Task 33: Source/emitted manifest tests

**Files:** Modify tests/manifest.test.ts and package.json; create scripts/check-extension-manifest.mjs and scripts/check-extension-manifest.test.mjs.

- [ ] **RED:** Fixture manifests missing webNavigation, containing forbidden permission/wildcard host/content script/wrong incognito fail; valid one passes.
- [ ] **Run:** node --test scripts/check-extension-manifest.test.mjs. Expect checker missing.
- [ ] **GREEN:** Add data-only emitted-manifest checker and build-then-check script.
- [ ] **Run:** Run node test and script after extension build. Expect pass.
- [ ] **REFACTOR:** Emitted inspection stays independent from source assertions.

### Task 34: Built-bundle privacy/security inspection

**Files:** Create scripts/check-extension-bundle-privacy.mjs and test; modify package.json; modify secret-scan.mjs only for narrow necessary assertion.

- [ ] **RED:** Synthetic bundles with service-role marker, chrome.tabs, content-script artifact, or raw-navigation fixture marker fail; clean fixture passes.
- [ ] **Run:** node --test scripts/check-extension-bundle-privacy.test.mjs. Expect checker missing.
- [ ] **GREEN:** Add narrow checker; run existing secret scan over emitted output with no new exclusions.
- [ ] **Run:** Run checker test, extension build, checker, and pnpm.cmd secret:scan. Expect pass.
- [ ] **REFACTOR:** Do not weaken scanner scope.

### Task 35: Complete regression suite

**Files:** Modify only files owning an identified M4-B regression.

- [ ] **RED:** Run full extension suite. Every regression becomes a focused test in its owning task; do not skip.
- [ ] **Run:** pnpm.cmd --filter @visual-ai/extension test. Expect pass after preceding GREEN tasks.
- [ ] **GREEN:** Correct only the owning task, rerun focus test, then full extension suite and contracts check.
- [ ] **Run:** pnpm.cmd --filter @visual-ai/extension test; pnpm.cmd contracts:check. Expect pass.
- [ ] **REFACTOR:** Preserve named regressions for status 0, first send, seven sends, stale delivery, ack projection, final 401, strict stores, lifecycle ordering.

### Task 36: Local verification

**Files:** No verification-only source files.

- [ ] **RED:** Run local verification; assign a failure to its owning task, never bypass it.
- [ ] **Run:**

```powershell
$formatFiles = git status --porcelain | ForEach-Object { $_.Substring(3) } |
  Where-Object { $_ -match '\.(ts|json|md|mjs)$' -or $_ -eq 'pnpm-lock.yaml' }
if ($formatFiles.Count -gt 0) {
  .\node_modules\.bin\prettier.cmd --check $formatFiles
} else {
  Write-Output "No changed format-supported files; targeted Prettier skipped."
}
pnpm.cmd contracts:check
pnpm.cmd lint
pnpm.cmd typecheck
pnpm.cmd test
pnpm.cmd build
pnpm.cmd secret:scan
pnpm.cmd supabase:migration-check
.\.venv\Scripts\python.exe -m pytest apps/api/tests -q
.\.venv\Scripts\python.exe -m mypy apps/api/src apps/worker/src packages/python-shared/src
.\.venv\Scripts\python.exe scripts\validate-skills.py
node scripts/check-extension-manifest.mjs
node scripts/check-extension-bundle-privacy.mjs
git diff --check
git status --short
```

- [ ] **GREEN:** Resolve only M4-B-caused failures. If dependency changed, check pnpm-lock formatting explicitly.
- [ ] **Run:** Repeat full block. Expect clean outputs except known unrelated repository-wide format drift, which must not be rewritten.
- [ ] **REFACTOR:** Confirm generated artifact, Windows line ending, lockfile, strict TypeScript, and bundle drift are absent before CI.

### Task 37: Security review

**Files:** Modify docs/adr/0007-m4-browser-navigation-capture.md and regression tests only for confirmed findings.

- [ ] **RED:** Review source/emitted manifests, stores, logs, messages, batches, retry errors, queue order, and bundle. Treat URL/hostname/title/DOM/browser-ID persistence, broad permission, policy overclaim, direct publisher use, or lifecycle race as a failing security case.
- [ ] **Run:** Execute associated focused regression for every confirmed finding; it must fail before fix.
- [ ] **GREEN:** Make smallest scoped fix, add regression, and record threat; affected component; evidence; exploit conditions; impact; remediation; required test; residual risk in ADR.
- [ ] **Run:** Run security regressions and Task 36 commands. Expect pass.
- [ ] **REFACTOR:** Confirm ADR states non-exhaustive policy, additive exclusions, no classifier, and no telemetry.

## Historical-regression mapping

| Failure                               | Preventing tasks                                              |
| ------------------------------------- | ------------------------------------------------------------- |
| Status 0 not retried                  | Task 18 has an explicit status-0 RED case.                    |
| Direct plus queued sends exceeded cap | Tasks 17-19 define one path and count first send.             |
| Delivering state became permanent     | Tasks 20 and 22 recover stable batch identity.                |
| Success deleted before projection     | Tasks 15 and 17 require count equality and atomic projection. |
| Final 401 inconsistent                | Task 24 uses one centralized worker auth shutdown.            |
| Broad scanner exclusion               | Task 34 scans built output without new exclusions.            |
| Generic denylist bypass               | Task 8 uses exact navigation allowlists.                      |
| Pause/stop overtook events            | Tasks 26-28 persist event-before-control dependency.          |
| Artifact/lock formatting drift        | Tasks 2, 33-36 format targeted files and inspect output.      |
| CI-only typing failure                | Task 36 runs strict TypeScript and Python mypy.               |
| Linux differed from local             | Task 36 records clean CI as authority.                        |

## Self-review

- **Coverage:** Tasks 1-34 follow the approved implementation order; Tasks 35-37 provide full regression, verification, and security review.
- **Authority:** Gate opens only after fresh remote reconciliation. Offline health is distinct from recording authority. Pause/stop close and drain before control mutation.
- **Privacy:** URL/hostname lifetime ends in normalizer/matcher. Event, batch, coordination, metric, log, popup, and message shapes are closed.
- **Reliability:** Status 0 retries, first send counts, seven is hard cap, stale delivery recovers, ack projection precedes deletion, and lifecycle order persists.
- **Scope:** No task permits extra capture, permission expansion, external classification, or implementation commit/push/merge.

## Execution handoff

Plan complete and saved to docs/superpowers/plans/2026-08-08-m4-browser-navigation-capture.md. Execute only after explicit authorization, one task at a time with the listed RED/GREEN/REFACTOR gates.
