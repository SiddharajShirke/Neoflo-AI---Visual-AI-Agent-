# ADR 0001: Use pnpm and uv workspaces

## Status

Accepted for Milestone 0.

## Decision

Use pnpm workspaces for the dashboard, extension, and TypeScript contracts. Use an uv workspace for FastAPI, the worker, and reusable Python modules.

## Consequences

Language-specific dependencies remain isolated while root commands provide a consistent developer experience. Cross-language contracts must remain canonical in `schemas/` rather than being duplicated manually.
