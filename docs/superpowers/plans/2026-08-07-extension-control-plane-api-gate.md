# Extension Control-Plane API Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing FastAPI control-plane mutations replay-safe, make consent withdrawal effective, and publish generated TypeScript contracts before Chrome extension behavior is added.

**Architecture:** FastAPI remains the authenticated public boundary. New service-role PostgreSQL RPCs atomically claim an existing owner-scoped idempotency record, apply one control-plane mutation, and save only safe response metadata. FastAPI hashes canonical JSON bodies and maps RPC outcomes to the existing public responses; generated TypeScript derives from versioned JSON Schemas.

**Tech Stack:** FastAPI/Pydantic, PostgreSQL/Supabase SQL migrations, pnpm TypeScript contracts, Vitest, pytest, pgTAP.

## Global Constraints

- Work only on `feature/chrome-extension-foundation`; do not commit, merge, or push.
- Add forward-only migrations; do not modify an applied migration.
- Do not add browser capture, screenshots, DOM access, AI, dashboard activity pages, or deployment work.
- Do not retain request bodies or raw idempotency keys outside request handling.
- Preserve client payload shapes and derive user identity solely from verified JWTs.

---

### Task 1: Capture the desired public behavior in failing FastAPI tests

**Files:**

- Modify: `apps/api/tests/test_api_security_and_lifecycle.py`
- Modify: `apps/api/tests/test_event_contract.py`

- [ ] Add timeout-after-commit replay tests for consent creation, session creation, and each fixed transition route.
- [ ] Add grant, withdrawal, repeated withdrawal, cross-device withdrawal, and revoked-consent session-rejection tests.
- [ ] Run the focused tests and confirm they fail because control-plane idempotency and withdrawal semantics do not exist.

### Task 2: Add failing contract fixtures and generation coverage

**Files:**

- Create: `schemas/api/*.v1.schema.json`
- Create: `schemas/api/fixtures/*.json`
- Modify: `scripts/generate-contracts.mjs`
- Modify: `scripts/generate-contracts.test.mjs`
- Modify: `packages/contracts/tests/*.test.ts`

- [ ] Add strict versioned schemas for the existing Device, Consent, Session, lifecycle, deletion, and error envelopes.
- [ ] Add tests that generation fails until these schemas are registered and generated output is imported by the package.
- [ ] Run the focused contract test and confirm the missing control-plane exports fail.

### Task 3: Add one forward-only transactional Supabase migration

**Files:**

- Create: `supabase/migrations/0016_control_plane_idempotency_and_consent_withdrawal.sql`
- Modify: `supabase/tests/006_milestone_2_api_primitives.sql`

- [ ] Add service-role-only RPCs which atomically claim/check an owner, route, key, and SHA-256 request hash before applying consent/session mutations.
- [ ] For withdrawal, lock and revoke only current active grants for the same owner/device/scope, then append the immutable withdrawal record.
- [ ] Add pgTAP assertions for privileges, replay result, conflict result, active-grant revocation, and cross-owner isolation.

### Task 4: Wire FastAPI through typed repository methods

**Files:**

- Modify: `apps/api/src/visual_ai_api/schemas.py`
- Modify: `apps/api/src/visual_ai_api/store.py`
- Modify: `apps/api/src/visual_ai_api/postgres.py`
- Modify: `apps/api/src/visual_ai_api/main.py`

- [ ] Add canonical request hashing and explicit typed response models.
- [ ] Require and validate `Idempotency-Key` for the listed consent/session mutation routes.
- [ ] Map completed replay, changed payload/route, and in-progress outcomes to safe API responses/errors without logging key material.

### Task 5: Generate and consume canonical TypeScript contracts

**Files:**

- Create: `packages/contracts/src/generated/control-plane.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `schemas/README.md`

- [ ] Generate strict TypeScript types and runtime validators from all new schemas.
- [ ] Add package tests using shared valid/invalid fixtures.
- [ ] Run `pnpm.cmd contracts:generate` and `pnpm.cmd contracts:check`.

### Task 6: Verify the complete gate

**Files:**

- Modify only if verification identifies a test-backed defect.

- [ ] Run Ruff, mypy, pytest, TypeScript lint/typecheck/tests, contract generation/check, build, secret scan, and migration-order validation.
- [ ] Run disposable Supabase reset and pgTAP if the CLI environment is available; otherwise report that CI must execute it.
- [ ] Perform a security review of idempotency data minimization, RPC grants, RLS, consent withdrawal, and generated contract coverage.
