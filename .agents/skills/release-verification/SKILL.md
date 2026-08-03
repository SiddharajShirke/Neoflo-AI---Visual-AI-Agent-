---
name: release-verification
description: Use immediately before claiming a milestone or release is complete, merging work, or handing off a release candidate for the Visual AI Browser Agent.
---

# Release verification

Read applicable `AGENTS.md`, complete diff, docs, deployment configuration, migrations, and tests. Confirm requested scope and absence of unrelated changes. Preserve feature branches and merge commits; never squash merge. Show `git log --graph` evidence.

Run established formatting, lint, type, unit, integration, required E2E, security, secret scanning, and build commands. Verify migrations/RLS, extension permissions/package contents, client bundle secrets, environment/privacy/retention docs, Vercel/Render config, and generated artifacts. Do not substitute inspection for execution.

Report each command actually run with actual status. Clearly identify checks blocked by credentials or infrastructure; do not hide failures or skips. The decision must be exactly `READY`, `READY WITH DOCUMENTED LIMITATIONS`, or `NOT READY`, with evidence.
