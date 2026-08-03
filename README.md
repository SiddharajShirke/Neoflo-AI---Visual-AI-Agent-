# Visual AI Browser Agent

Milestone 0 provides a safe, runnable repository foundation for a future Visual AI Browser Agent. It includes a Manifest V3 extension shell, Next.js dashboard shell, FastAPI health service, worker shell, shared contract directories, Supabase directory scaffold, quality tooling, CI, and architecture decisions.

It deliberately does **not** implement product behavior: no browser capture, screenshots, real authentication, product API routes, product database schema, RLS, Storage policies, queues, pgvector, or LLM integration.

Local Python development uses a repository-local Python 3.11.9 virtual
environment; see [local development](docs/architecture/local-development.md)
and [developer commands](docs/runbooks/development.md). Repository-wide rules
are in [AGENTS.md](AGENTS.md).
