# Chrome Extension Foundation Implementation Plan

> **For agentic workers:** Implement inline with a failing-test-first cycle for every behavioral unit. Do not commit, push, merge, or add browser-content collection.

**Goal:** Build the Manifest V3 popup/service-worker control plane for authenticated, consented monitoring-session lifecycle operations without collecting browser content.

**Architecture:** The MV3 service worker owns Supabase Auth and all FastAPI traffic. The popup sends typed commands and receives sanitized state only. IndexedDB persists non-secret control-plane state and a retry queue; `chrome.storage.session` is the exclusive token store.

**Tech Stack:** WXT/Vite, TypeScript, Vitest, Supabase JS, browser `chrome.*` APIs, IndexedDB, generated `@visual-ai/contracts` validators.

## Global Constraints

- Request only `storage`, `alarms`, and exact FastAPI/Supabase Auth hosts; use `incognito: not_allowed`.
- Do not create content scripts, browser-event ingestion, capture, URL/DOM access, screenshots, or direct Supabase operational-data access.
- Never persist or log passwords, tokens, Authorization headers, cookies, browser data, or queue credentials.
- Use `m3-monitoring-v1` for monitoring consent and `m3-capture-v1` only for the required session contract field.
- All supported queued backend mutations carry a UUID idempotency key and are sent by the service worker only.

### Task 1: Establish manifest, public configuration, and pure state model

**Files:** modify `apps/extension/{.env.example,wxt.config.ts,src/manifest.ts}`; create `src/core/{types,state-machine}.ts`; test `tests/{manifest,state-machine}.test.ts`.

1. Write manifest and reducer tests for permissions, forbidden capabilities, valid transitions, and invalid no-op transitions.
2. Run the tests and confirm the new module imports fail before implementation.
3. Add the exact-host manifest configuration and typed pure reducer.
4. Re-run the focused tests.

### Task 2: Add secret-safe persistence and authentication ownership

**Files:** create `src/{auth/session-storage.ts,auth/supabase-client.ts,persistence/database.ts,persistence/domain-rules.ts}`; test `tests/{auth,persistence}.test.ts`.

1. Write failing tests for asynchronous session storage, logout clearing, IndexedDB schema upgrades, and secret-field rejection.
2. Implement the Chrome session adapter, worker-only Auth boundary, and versioned IndexedDB facade.
3. Re-run focused tests; test MFA/SSO extensibility through the Auth boundary rather than popup coupling.

### Task 3: Add canonical FastAPI client and retry queue

**Files:** create `src/{api/client.ts,queue/retry.ts,queue/mutations.ts}`; test `tests/{api-client,queue}.test.ts`.

1. Write failing tests for validator use, idempotency headers, safe error classification, 401 one-refresh retry, bounded retry, permanent failures, and 409 reconciliation.
2. Implement explicit typed client methods and non-secret mutation records.
3. Re-run the focused tests and verify no internal endpoint can be requested.

### Task 4: Add device/consent/session orchestration and restart recovery

**Files:** create `src/core/orchestrator.ts`; modify `src/entrypoints/background.ts`; test `tests/orchestrator.test.ts`.

1. Write failing tests for installation-ID reuse, consent grant/withdrawal, consent-gated start, all session transitions, restart reconciliation, offline buffering, and blocked auth.
2. Implement worker lifecycle orchestration, alarms, badge/title updates, and recovery from IndexedDB/session storage.
3. Re-run focused tests and assert no invalid transition invokes the API.

### Task 5: Add popup UI and privacy settings

**Files:** create `src/entrypoints/popup/{index.html,main.ts,styles.css}`; test `tests/popup-view-model.test.ts`.

1. Write failing view-model tests for signed-out, ready, recording, paused, offline, and synchronization-error controls.
2. Implement typed popup messages, sanitized rendering, consent/device/session controls, future-only domain exclusions, and dashboard link.
3. Re-run focused tests and inspect that no password/token appears in rendered state.

### Task 6: Security review and verification

1. Run targeted Prettier on changed supported files, ESLint, typecheck, extension/workspace tests, contracts check, build, manifest tests, secret scan, and `git diff --check`.
2. Run Playwright only if the installed runtime supports extension loading; otherwise record the exact limitation.
3. Inspect the manifest, generated bundle, persistence records, queue records, and diff for forbidden permissions, content scripts, credentials, and browser-content fields.
