---
name: deployment-vercel-render
description: Use for deploying or reviewing the Next.js dashboard on Vercel and the FastAPI/LangGraph backend on Render, including runtime configuration and production verification.
---

# Vercel and Render deployment

Read applicable `AGENTS.md`, deployment files, environment examples, architecture/security docs, manifests, and tests first. Follow existing deployment conventions and document variables without values.

Deploy the dashboard to Vercel and FastAPI as a Render Web Service. Bind Render to `0.0.0.0` and platform port; never use local disk durably. Use Supabase for durable state and Upstash for temporary state. Support bounded on-demand queue processing for the unpaid MVP and preserve continuous worker mode for future paid infrastructure.

Keep backend variables out of `NEXT_PUBLIC`/`VITE` variables and browser bundles. Configure explicit CORS for production Vercel origin and production extension ID; keep preview separate. Validate Supabase redirects. Handle cold starts with IndexedDB buffering and idempotent retries. Provide health/readiness endpoints and never expose worker tokens.

Verify Vercel/Render builds, auth callback, extension API request, CORS rejection, persistence, queue insertion/processing, LangGraph result, dashboard update, cold-start recovery, and client secret absence. Run smoke tests and give rollback instructions; report unavailable infrastructure accurately.
