# Canonical contracts

`schemas/` is the canonical cross-language contract directory. Milestone 0 defines only a health response and a non-operational source-event envelope shape. It does not collect, persist, queue, or process events.

Milestone 2 adds strict versioned API error and browser-event-batch envelopes.
The event schema is intentionally redacted and cannot grow raw browser-content,
cookie, credential, clipboard, screenshot, DOM, or user-ID fields.

Future milestones must version schemas additively and generate TypeScript and Python validation artifacts from them before adding cross-component behavior. Generated TypeScript artifacts are committed under `packages/contracts/src/generated/`, contain a `DO NOT EDIT` header, and are regenerated deterministically with `pnpm contracts:generate`.
