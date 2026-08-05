# Milestone 1 Release-Gate Repair Design

## Goal

Make the existing Milestone 1 Supabase foundation verifiable for release without expanding the approved milestone scope.

## Scope

Correct synthetic pgTAP fixtures that violate the monitoring-session state constraint. Add deterministic, rollback-safe SQL assertions for schema constraints, two-user RLS isolation, private Storage policy behavior, queue reference-only messages, deletion cascades and state idempotency, cross-owner relationship rejection, browser-event idempotency, and system domain-rule protection.

Run repository formatting and all locally available quality checks. Re-run linked staging migration, lint, SQL-test, and dry-run checks when the local Docker test runner is available.

## Design

All product schema behavior remains in the forward-only migrations already deployed. The repair changes only SQL test coverage and formatting unless an existing migration behavior is proven wrong by a newly added regression test. Each test file continues to use synthetic fixed UUIDs and `example.test` addresses, starts a transaction before fixture data is created, and ends with `rollback`.

`000_setup.sql` remains responsible only for the pgTAP prerequisite. The release report will explicitly identify any test-runner requirement that cannot be satisfied by the host, rather than treating it as a passing check.

## Non-goals

No API routes, browser capture, screenshot upload or deletion orchestration, signed URLs, LangGraph/LLM calls, dashboard product pages, retention schedules, or deployment changes are permitted. No production reset, production data access, commit, or merge is permitted.

## Acceptance Criteria

- Every requested SQL coverage category has an executable pgTAP assertion.
- SQL fixtures satisfy the schema constraints before assertions run.
- Tests contain synthetic data only and roll back fixture mutations.
- Formatting, TypeScript checks, builds, secret scan, migration-order check, and Python checks pass when their host prerequisites exist.
- Linked staging migration list, lint, SQL test, and dry-run results are recorded with their true status.
