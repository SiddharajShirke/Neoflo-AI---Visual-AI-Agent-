---
name: end-to-end-testing
description: Use for deterministic cross-component tests that span the Chrome extension, dashboard, FastAPI API, Supabase, queues, and LangGraph worker.
---

# End-to-end testing

Read applicable `AGENTS.md`, existing unit/integration tests, architecture/security docs, setup files, and environment examples before adding tests. Use deterministic accounts, isolated data, and synthetic websites only; never test real sensitive sites. Keep runs parallel-safe, diagnostics useful but private, and clean up test data.

Cover login, consent, monitoring start, navigation/click, local queue, batch upload, persistence, queue insertion, LangGraph processing, observation/activity creation, dashboard display, and session deletion. Also cover pause/resume, blocked domains, password/payment suppression, offline sync, cold-start retry, duplicate idempotency, and two-user isolation.

Wait on observable conditions instead of fixed sleeps. Record exact commands and actual results. Do not declare the flow successful until the final user-visible state is verified. Require tests for behavior changes and never fabricate infrastructure outcomes.
