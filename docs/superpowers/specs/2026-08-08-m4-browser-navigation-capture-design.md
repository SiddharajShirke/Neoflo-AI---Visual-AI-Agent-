# Milestone 4-B: Privacy-Safe Browser Navigation Capture

## 1. Objective and non-goals

M4-B adds visible, privacy-minimized navigation capture to the Manifest V3 extension. Only while a remotely reconciled monitoring session is recording, the service worker observes committed top-level HTTP(S) navigations, derives a registrable page_domain, filters locally, durably batches canonical Browser Event v2 records, and uses the existing event-batch API.

It does not add content scripts, DOM/page/title/text extraction, click/scroll/keyboard/form capture, screenshots, OCR, browser history, cookies, clipboard, tab/document/process persistence, transition qualifiers, AI/LLM work, or any browser capture other than committed top-level navigation.

## 2. M4-A dependency

M4-B depends on the completed M4-A gate. Its sole payload is canonical BrowserEventV2: UUID client_event_id, positive sequence_number, literal navigation event kind, occurred_at, registrable page_domain, approved transition_type, and capture_policy_version. The existing POST /api/v1/events/batch is v2-only; M4-A owns authentication, device/consent/session/policy validation, idempotency, transactional ingestion/outbox, and its reference-only queue body. M4-B does not alter v1, M4-A migrations, or the internal outbox publisher.

## 3. webNavigation capture source

The service worker owns one chrome.webNavigation.onCommitted listener. It processes only committed events with frameId equal to 0 and accepts only http: and https:. It registers no other navigation listener and uses no Chrome tabs API.

## 4. Exact permission delta

The source manifest changes from storage and alarms to exactly storage, alarms, and webNavigation. Existing exact API/Supabase host permissions remain unchanged. No browser-site host permission, optional host permission, tabs, activeTab, history, cookies, scripting, identity, clipboard, capture, side-panel, or all-sites permission is added. Incognito remains not_allowed and no content_scripts entry is allowed.

## 5. CaptureGate

CaptureGate is a worker-owned, initially closed authority object. It opens only when authentication, active device, active consent, a freshly reconciled remote recording session, exact m4-navigation-v1 policy, and non-fatal navigation sync health are all present. Its context contains only generation, device ID, session ID, and policy version.

Monitoring authority and sync health are separate. A transient offline delivery condition may be displayed as OFFLINE_BUFFERING while the underlying freshly reconciled authority remains recording; capture may remain open until capacity or permanent-sync failure. SYNC_ERROR, authentication loss, consent loss, device revocation, policy mismatch, pause, stop, and unreconciled state close the gate.

## 6. Generation and concurrency barrier

Every open or close changes a monotonically increasing durable gate generation. A handler acquires an in-flight lease, checks generation before reading the URL, normalizes and filters, then checks generation again immediately before append. The append transaction reads durable generation and open state before allocating a sequence.

Close first changes in-memory state synchronously, then persists the incremented closed generation, then waits for existing leases. If close wins the IndexedDB transaction, append aborts; if append wins, it belongs to the pre-close generation and close waits for it before pause or complete is sent. No post-barrier append can occur.

## 7. Raw URL lifetime

details.url is sensitive transient input. Only a narrow normalizer receives it. The handler never logs or forwards Chrome's details object. The normalizer may parse the URL and inspect hostname, then returns a safe ignore reason or page_domain; it never returns URL or hostname.

URLs, origins, ports, credentials, paths, queries, fragments, titles, DOM/text, Chrome IDs, timestamps, qualifiers, request bodies, and raw errors never enter IndexedDB, runtime messages, popup state, metrics, logs, snapshots, or API payloads.

## 8. Registrable-domain derivation

The normalizer uses URL solely in memory, rejects non-HTTP(S), credentials, localhost, .local, IP literals, single-label names, malformed hostnames, and bare public suffixes, then derives a normalized registrable public domain. It does not use last-two-label parsing. Only that derived domain may proceed to event construction.

## 9. PSL dependency and update policy

M4-B will add a pinned, bundled offline PSL parser such as tldts, configured with allowPrivateDomains false. It makes no network lookup or telemetry request. The M4-B ADR records dependency version, PSL provenance/revision, license, update date, and fixture changes. PSL updates require a reviewed dependency update and deterministic fixture regression tests.

## 10. IDN and punycode behavior

URL.hostname provides the transient normalized ASCII hostname. Its registrable output is accepted only if it also passes the existing v2 runtime validator. Supported ASCII/punycode label cases work; an IDN whose resulting domain cannot be represented by the current v2 schema is conservatively dropped. Unicode display forms and original hostnames are never stored.

## 11. User exclusion rules

Existing M3 user rules retain hostname-level semantics and are not migrated or silently collapsed to registrable domains. A normalized rule matches the same hostname or a dot-boundary subdomain, never a lookalike suffix. Matching occurs only against transient normalized hostname before v2 creation. Existing user-entered rule configuration is not observed navigation data, and the pipeline never adds observed hostnames to that store.

## 12. Protected-domain artifact

The runtime artifact is checked-in JSON at apps/extension/src/privacy/protected-domains-v1.json. It is static data only:

{
"policy_version": "protected-domains-v1",
"provenance": {
"type": "first-party-curated",
"owner": "Neoflo Security & Privacy",
"reviewed_at": "2026-08-08",
"description": "Manually reviewed conservative seed rules."
},
"rules": []
}

Each rule has exactly category, domain, and match_type. Categories are authentication_account_recovery, payments_financial, or health. match_type is only exact or suffix. The artifact contains no source URLs, regexes, callbacks, executable logic, or remote-update mechanism.

## 13. Approved protected seed rules

| Category                        | Domain                    | Match type |
| ------------------------------- | ------------------------- | ---------- |
| authentication_account_recovery | accounts.google.com       | exact      |
| authentication_account_recovery | login.microsoftonline.com | exact      |
| authentication_account_recovery | account.apple.com         | exact      |
| payments_financial              | www.paypal.com            | exact      |
| payments_financial              | secure.bankofamerica.com  | suffix     |
| health                          | portal.athenahealth.com   | suffix     |

Review evidence for these choices belongs in ADR/design documentation, never in the runtime policy artifact.

## 14. Protected-policy governance

The artifact is first-party curated, local, deterministic, conservative, and non-exhaustive. It has no external category-classification service and makes no classification request. A policy update is a reviewed source change with a new policy version and provenance review. The popup and ADR state exactly:

> The built-in protected-domain policy is a conservative, non-exhaustive protection layer. User exclusions provide additional protection.

Absence from the policy is never evidence that a site is non-sensitive. Built-in rules cannot be removed or disabled; user rules can only add protection. The validator rejects malformed/non-lowercase domains, schemes/paths/ports, local names, unknown enums, and duplicate rules rather than applying order-dependent behavior.

## 15. BrowserEventV2 construction

Only after gate revalidation and filtering, the worker constructs exactly the seven M4-A v2 fields: crypto.randomUUID(), transactionally allocated positive sequence, navigation, extension-clock ISO timestamp, registrable page_domain, canonical approved transition type, and m4-navigation-v1. Unsupported Chrome transitions are dropped and increment only ignored_transition. Qualifiers are never persisted or sent.

## 16. Session-local sequence allocator

A typed navigation coordination record stores next_sequence_number for the one active/draining session. Append reads, allocates, increments, and writes it in one IndexedDB read-write transaction. The first event is 1; values are never reused after restart. New capture cannot start while an older session has unacknowledged navigation records, preventing unbatched-record misassociation.

## 17. In-memory duplicate suppression

A fixed-size, short-TTL in-memory cache suppresses duplicate committed events as an optimization. It may use document ID, tab ID, and Chrome timestamp only transiently as a cache key; none is persisted, logged, metered, or transmitted. The cache clears on worker restart. UUID event identity and server idempotency remain authoritative.

## 18. IndexedDB v2 to v3 migration

The database upgrades forward from v2 to v3 without deleting, recreating, or rewriting M3 stores and data. It adds two strict navigation stores plus typed navigation coordination and metric records in existing sync_metadata. These records have named TypeScript schemas and exact field allowlists; no arbitrary metadata object exists.

## 19. navigation_event_buffer schema

Key path is client_event_id. Allowed fields are exactly client_event_id, sequence_number, event_kind, occurred_at, page_domain, transition_type, capture_policy_version, delivery_state, optional batch_id, and created_at.

delivery_state is a closed unbatched/batched enum. Records are immutable after batch assignment except for the repository-managed closed state and batch fields.

## 20. navigation_batches schema

Key path is batch_id. Allowed fields are exactly batch_id, idempotency_key, device_id, session_id, ordered event IDs, canonical_request_hash, retry_count, next_retry_at, delivery_state, created_at, and updated_at.

There is no raw request body, browser metadata, arbitrary metadata, or authorization field. Event IDs are client UUIDs only.

The batch delivery_state enum is exactly pending, delivering, failed_permanent, or blocked_auth. Successful batches are removed during acknowledgement projection rather than retained as a third history store.

## 21. Strict per-store allowlists

Navigation records never use generic M3 persistence. Dedicated typed repository methods validate exact own keys at runtime and TypeScript types at compile time. The coordination record is likewise exact: buffer session ID, gate generation/open state, next sequence, event count, byte estimate, oldest pending timestamp, sync status, and closed lifecycle intent. The metric record is separate and fixed-shape counters/histogram buckets only. Unknown keys reject before write.

## 22. Capacity and fail-closed behavior

The buffer allows at most 1,000 unacknowledged events or 1 MiB estimated serialized event data, whichever comes first. Candidate-event byte size is calculated once before append and counters change transactionally; the whole database is not repeatedly serialized. At capacity, the candidate is not written, old records are never evicted, the gate closes, and a visible safe sync error remains until successful delivery and reconciliation permit recovery.

## 23. Batching rules

Named defaults are MAX_BATCH_EVENTS = 20 and FLUSH_INTERVAL = 30 seconds. The repository forms ordered batches only from current-session unbatched events. Flush is requested on batch fullness, durable alarm, startup/recovery, manual safe retry, pause, and stop.

## 24. Immutable batch semantics

Batch membership and sequence order are fixed once formed. Batch ID, idempotency key, canonical body, and SHA-256 request hash never change. The body is deterministically rebuilt from immutable event records and its hash must match before every send. New events never join a retrying batch.

An ingestion response acknowledges a batch only when accepted_count plus duplicate_count equals its immutable member count. In one IndexedDB transaction the repository then deletes exactly those event records and the batch, and updates aggregate sync state. A malformed or partial response deletes nothing and becomes SYNC_ERROR.

## 25. Alarm scheduling

The worker uses one-shot Chrome alarms, not setInterval or a timer as its only mechanism. It schedules the earliest flush/retry due time and recreates important alarms at startup. Thirty seconds is a lower-bound target: Chrome may delay alarms, so batch-full sends and startup recovery ensure correctness without claiming precise timing.

## 26. Retry policy

Retryable outcomes are transport/status 0, 408, 425, 429, and 5xx. Backoff is full-jitter exponential, base five seconds and cap five minutes; numeric Retry-After is bounded by that cap. 400, 403, 404, 409, and 422 are not blindly retried. Final 401 uses the existing centralized auth boundary and does not create another refresh loop.

## 27. Exactly-seven-total-send accounting

retry_count means total HTTP sends already started, including the first. New batches begin at zero. The delivery-claim transaction increments to one and persists delivering before network I/O. A batch receives at most seven total automatic sends; retry is allowed only while another send remains. There is no direct-send path separate from queued delivery.

## 28. Stale-delivering recovery

One navigation delivery loop serializes alarm, startup, and manual triggers. It persists delivering before send. On restart, unresolved delivering becomes pending without changing batch ID, event membership, ordering, request hash, idempotency key, or send count.

## 29. M4-A typed outcome handling

device_revoked, consent_inactive, session_not_recording, and capture_policy_mismatch are safe server-authority outcomes, not generic transport failures. Each closes CaptureGate immediately and receives the specific handling below; none causes blind retries.

## 30. Authentication-loss behavior

On final authentication_required, close the gate first, purge unacknowledged navigation events and batches for the invalid session, clear worker auth through the centralized M3 boundary, sanitize popup state, and preserve no browser event payload in error handling. Authorization is never persisted.

## 31. Consent, device, and policy invalidation behavior

For device_revoked, consent_inactive, or capture_policy_mismatch, close the gate, purge all unacknowledged navigation records/batches for that session, project safe local state, and give non-content user guidance. Sending after these outcomes is unauthorized. Consent withdrawal uses the same gate-first order before its control-plane mutation is processed.

## 32. session_not_recording reconciliation

Close the gate and reconcile the remote session once. If it is paused, completed, or cancelled, purge records the server can no longer accept and project that state. If it reports recording, retain the batch in safe sync error pending explicit user retry after reconciliation; do not loop.

## 33. Pause barrier

Pause closes the gate, commits durable closed generation, waits for in-flight leases, forms/flushes session batches, and waits for acknowledgement or an explicitly authorized terminal state. Only then may it send remote pause and project PAUSED. A normal permanent delivery failure remains SYNC_ERROR and blocks remote pause; it is not authority to discard data.

The only authorized terminal outcomes are the explicit authorization-invalid purges in sections 30-31, or a session_not_recording reconciliation that confirms a server-terminal session in section 32. Those outcomes do not send a superseded pause mutation.

## 34. Stop barrier

Stop uses the same close, durable barrier, drain, and terminal-outcome rules as pause, then sends remote complete and projects STOPPED. It cannot start a new session until prior navigation records drain or are authorization-purged.

## 35. Offline pause and stop ordering

Offline pause/stop closes capture immediately and stores a typed per-session lifecycle intent in navigation coordination. A shared delivery coordinator drains event batches before creating or delivering the M3 pause/complete mutation. The dependency survives restart, so independent queues cannot race and control plane cannot overtake navigation events.

## 36. Start and resume gate opening

Start opens only after remote create-session success, durable local projection, and remote reconciliation to recording with m4-navigation-v1. Resume remains closed until remote resume succeeds and fresh reconciliation succeeds. Existing sessions with another/missing policy are capture-disabled, never reinterpreted.

## 37. Service-worker restart recovery

Startup restores non-secret M3 state, navigation stores, counters, lifecycle intent, and batches; recovers stale delivery; then, if authenticated, reconciles remotely before opening the gate. Without authentication, capture stays closed. It schedules pending delivery but never trusts local recording alone.

## 38. API client extension

Add one worker-only fixed ingestBrowserEventBatch method to ApiClient. It accepts only runtime-validated BrowserEventBatchV2, uses stable idempotency, injects authorization only at send time, and calls only the existing public event-batch route. It has no arbitrary fetch path, Supabase operational access, or internal outbox-publisher access.

## 39. Aggregate-only metrics

Local fixed-shape aggregate counters/histograms measure capture/normalization duration, IndexedDB append, batch construction, HTTP latency, batch size, retry count, pending count/bytes, and oldest pending age. Ignore counters cover non-HTTP, subframe, invalid domain, user exclusion, protected domain, duplicate, and unsupported transition. Metrics have no domain, URL, event/browser ID, body, or telemetry upload. Targets are p95 under about 5 ms for handler/filter excluding IndexedDB and under about 10 ms for normal desktop append.

## 40. Safe logging

Use a typed safe logging boundary. Allowed fields are operation, event count, retry count, safe API code, request ID, and queue depth. It must not accept Chrome details, URL, hostname, page domain, event/batch body, token, Authorization, raw response, or arbitrary error object.

## 41. Popup and indicator changes

The indicator remains visible for recording, paused, offline buffering, and sync error. The popup may show safe queue health/status and the static policy statement, but never navigation records or domains. It may list existing user exclusions; it cannot edit system rules.

## 42. Source manifest requirements

Source-manifest tests assert exactly storage, alarms, and webNavigation; only existing API/Supabase hosts; incognito not_allowed; and no content scripts or forbidden browser-data permission.

## 43. Emitted manifest requirements

After WXT build, a test inspects the emitted Chrome MV3 manifest and asserts the same permission, host, incognito, and no-content-script invariants. Source success alone is insufficient.

## 44. Built-bundle privacy requirements

The built extension is secret-scanned without broad generated-bundle exclusions. Bundle inspection verifies no service-role key and no forbidden browser permission/capture artifact. No raw navigation fixture or real browsing data enters the build.

## 45. Complete test matrix

Tests cover all gate states and offline/fatal-sync behavior; pause generation race; top-level/scheme/malformed filtering; PSL, uppercase, suffix, local/IP/single-label, and IDN cases; exact/suffix user and protected matching; policy metadata/validation/duplicates; UUID, positive concurrent sequences, transition mapping, and prohibited fields; v2-to-v3 preservation and strict stores; capacity limits; batch size/order/hash/key immutability; alarm/startup flush; every retry status, Retry-After, jitter, and exactly-seven accounting; stale delivery/restart; typed outcomes/auth purge/reconciliation; pause/stop/offline ordering; delayed start/resume; aggregate-only metrics; safe logging; source/emitted manifest restrictions; built-bundle secret scan; and proof protected input produces no event, navigation record, batch, or API request and increments only the protected counter.

## 46. Browser-level Playwright limitation

M4-B does not add a mock and call it browser integration. Reliable persistent-context MV3 Chromium testing needs supported extension loading plus a real authenticated/reconciled fixture seam, which the repository lacks. M4-B provides worker integration through a typed Chrome fake; real Playwright smoke coverage is a separately scoped follow-up.

## 47. CI verification strategy

Run targeted Prettier only on changed M4-B files; never repository-wide format writes. Run extension tests/typecheck/build, workspace lint/typecheck/test/build, contracts check, secret scan, migration check, skill validation, and git diff --check. Inspect emitted manifest and built bundle after build. If a dependency is added, check pnpm-lock.yaml formatting. Clean-checkout Linux CI is authoritative for global format, contract drift, TypeScript/Python, secret scan, and disposable Supabase verification.

## 48. Threat model

Threats are raw-location leakage, overbroad permissions, protected/excluded bypass, stale worker delivery, retry over-send, authorization races, buffered-data overwrite, unsafe logging, and event/control-plane ordering. Mitigations are local minimization before construction, strict stores, generation barrier, PSL parsing, deterministic matching, immutable idempotent batches, capped attempts, server-authoritative outcomes, fail-closed capacity, typed logs, and persistent event-before-control coordination. Residual risk is that curated protection is non-exhaustive; user exclusions and policy language make that explicit.

## 49. Explicitly deferred features

Deferred: content scripts; page/DOM/title/text/accessibility capture; click, scroll, mouse, keyboard, form, password, clipboard, cookie, history, screenshot, OCR, tab/document/process tracking; transition qualifiers; AI/LLM/embeddings; telemetry upload; queue consumers; and browser-level Playwright infrastructure.
