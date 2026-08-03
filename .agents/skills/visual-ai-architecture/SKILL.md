---
name: visual-ai-architecture
description: Use when designing, reviewing, or substantially changing the Visual AI Browser Agent architecture, component boundaries, data flows, provider interfaces, or deployment topology.
---

# Visual AI architecture

Before acting, read all applicable `AGENTS.md`, architecture, setup, security, deployment, manifests, environment examples, migrations, and tests. State assumptions and report conflicts; do not replace repository decisions with this skill.

Inspect the existing architecture first. Identify impacted components and interfaces, preserve monorepo boundaries, and make a design plus implementation plan before substantial change. Keep the approved shape: Manifest V3 Chrome extension, Next.js dashboard, FastAPI API, LangGraph worker, Supabase Auth/PostgreSQL/Storage/Queues/pgvector, Upstash Redis, Groq primary LLM with optional NVIDIA fallback, Vercel dashboard, and Render API.

Prefer event-driven capture, DOM/accessibility context, and bounded deterministic workflows over recording, screenshot-first approaches, autonomous behavior, new services, or paid infrastructure. Keep providers replaceable. Require source-event provenance for every AI observation. Refuse hidden monitoring, keylogging, credential capture, or stealth surveillance.

Assess data flow, security, privacy, reliability, deployment, and testing. Record important choices as ADRs. Use small reviewable changes, established commands, and tests for behavior changes; never expose credentials or invent verification.

Finish with: affected components; proposed interfaces; data flow; failure cases; privacy implications; test strategy; migration strategy; deployment implications; unresolved risks.
