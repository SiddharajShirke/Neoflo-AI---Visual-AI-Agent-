# Canonical contracts

`schemas/` is the canonical cross-language contract directory. Milestone 0 defines only a health response and a non-operational source-event envelope shape. It does not collect, persist, queue, or process events.

Future milestones must version schemas additively and generate TypeScript and Python validation artifacts from them before adding cross-component behavior.
