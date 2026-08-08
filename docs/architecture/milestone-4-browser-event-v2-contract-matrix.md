# Milestone 4-A browser-event.v2 contract matrix

`browser-event.v2` is additive. The Milestone 2 v1 contract and its historical
meaning remain unchanged.

| Field                    | Type                                 | Privacy classification        | Persistence rule                                      |
| ------------------------ | ------------------------------------ | ----------------------------- | ----------------------------------------------------- |
| `client_event_id`        | RFC 4122 UUID                        | Pseudonymous event identity   | Persist as v2 event identity only                     |
| `sequence_number`        | positive integer                     | Local ordering metadata       | Persist                                               |
| `event_kind`             | literal `navigation`                 | Event category                | Persist                                               |
| `occurred_at`            | RFC 3339 timestamp                   | Timing metadata               | Persist                                               |
| `page_domain`            | normalized domain                    | Minimised navigation metadata | Persist; never URL/origin/path/query/fragment/port    |
| `transition_type`        | approved top-level Chrome transition | Navigation provenance         | Persist; excludes subframe transitions and qualifiers |
| `capture_policy_version` | bounded string                       | Policy provenance             | Must match the recording session                      |

Batch metadata is restricted to `device_id` and `session_id`. V2 prohibits
URL, origin, host, port, path, query, fragment, title, DOM, text,
accessibility context, tab/document/process identifiers, and transition
qualifiers. The queue payload is reference-only: `browser_event_id` and
`contract_version: 2`.
