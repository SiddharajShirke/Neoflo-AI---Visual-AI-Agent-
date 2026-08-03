---
name: privacy-security-review
description: Use for privacy reviews, security reviews, threat modeling, or changes that handle browser content, authentication, authorization, storage, queues, logs, or AI inputs and outputs.
---

# Privacy and security review

Read applicable `AGENTS.md`, security/architecture docs, manifests, environment examples, migrations, and tests before review. Treat browser content as untrusted; review collection before implementation. Apply minimization and deterministic privacy rules that no LLM can override. Verify explicit consent and visible monitoring.

Review permissions, URL/sensitive-field detection, redaction, authn/authz, RLS, Storage, queue/cache payloads, logging, prompt injection, isolation, deletion/retention, and secrets. Look for client service-role keys, logged secrets, unrestricted CORS, public buckets, missing RLS, insecure signed URLs, cross-user access, pre-redaction screenshots, sensitive Redis data, unvalidated LLM output, and hidden monitoring.

Never print secrets or modify production data. Distinguish confirmed vulnerabilities from hypotheses. For each finding, give severity (critical/high/medium/low/informational), evidence, impact, and minimal remediation. Require a regression test before marking a vulnerability fixed.

Finish every finding with: threat; affected component; evidence; exploit conditions; impact; remediation; required test; residual risk.
