# System overview

Milestone 0 establishes a pnpm TypeScript workspace and an uv Python workspace. The deployable applications are a Manifest V3 Chrome extension, Next.js dashboard, FastAPI API, and independently runnable worker shell. Reusable TypeScript contracts and Python-neutral foundation modules live under `packages/`; canonical JSON Schemas live under `schemas/`.

The intended production topology is Vercel for the dashboard and a Render Web Service for the API. On the unpaid MVP tier, the API performs only bounded on-demand processing; a continuous `apps/worker` entry point remains available for a future paid deployment. Supabase will later provide Auth, PostgreSQL, Storage, Queues, and pgvector. Upstash will later provide cache, rate limiting, and processing locks.

No product data flow exists in Milestone 0. The only API behavior is non-sensitive health/readiness responses. The extension has no browser-data permissions or capture code; the dashboard has a static placeholder page; the worker reports metadata and exits.
