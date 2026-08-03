# ADR 0003: Use bounded on-demand processing on the unpaid MVP tier

## Status

Accepted for Milestone 0.

## Decision

Deploy the dashboard to Vercel and FastAPI to a Render Web Service. Keep `apps/worker` independently runnable for a future continuous deployment, but do not require a Render background worker for the unpaid MVP.

## Consequences

The API will later own bounded on-demand processing. Continuous queue polling is deliberately deferred until paid infrastructure is available.
