---
name: chrome-extension-engineering
description: Use when implementing or reviewing the project’s Chrome Manifest V3 extension, including capture, content scripts, service workers, permissions, offline delivery, or extension privacy controls.
---

# Chrome extension engineering

Read applicable `AGENTS.md`, manifest, extension architecture, setup/security docs, manifests, environment examples, and tests first. Follow established commands and make only focused, test-backed changes.

Use Manifest V3, minimum permissions, and optional host permissions. Do not add cookie/history access or unrestricted hosts without documented approval. Keep credentials out of bundles, show monitoring visibly, require explicit start/pause/resume/stop, and disable incognito monitoring.

Use content scripts only for page observation and the service worker for orchestration. Persist essential worker state; queue offline events in IndexedDB; make uploads idempotent; use an offscreen document only when image processing needs it. Validate cross-context messages and sanitize URLs/DOM context.

Prefer event-triggered screenshots with cooldown and deduplication. Detect sensitive pages and suppress blocked domains before any screenshot is produced. Never collect raw keystrokes, passwords, OTPs, card numbers, CVVs, auth tokens, cookies, clipboard history, or hidden form values.

Verify build, manifest validity, permissions, state machine, privacy suppression, offline queue, restart recovery, CORS, and absence of bundle secrets. Add unit and Playwright coverage for meaningful behavior. Stop and report privacy/security violations; never claim success without fresh results.
