# ADR 0007: Static protected-domain policy for browser navigation capture

## Status

Accepted for Milestone 4-B.

## Context

The browser navigation pipeline must minimize sensitive input locally before a
Browser Event v2 record can be created. A small built-in policy is needed for
known first-party authentication/account-recovery, payment/financial, and
health destinations. It must be deterministic, local, and auditable without
turning a browsing event into a remote classification request.

## Decision

`apps/extension/src/privacy/protected-domains-v1.json` is checked-in static
data with the fixed `protected-domains-v1` version, first-party-curated
provenance, and six approved rules. It contains only policy metadata and rule
category/domain/match-type fields. It contains no evidence or source URL,
regular expression, callback, executable rule, or remote-update mechanism.

The runtime validator accepts only closed top-level, provenance, and rule
objects. It requires lowercase, syntactically valid domains; rejects schemes,
paths, ports, unknown categories or match types, unknown keys, and duplicate
domain/match-type pairs. Duplicate rejection avoids list-order-dependent
behavior.

The built-in protected-domain policy is a conservative, non-exhaustive protection layer. User exclusions provide additional protection.

The policy is additive: absence from it is not evidence that a site is
non-sensitive, built-in rules cannot be disabled, and user exclusions add
protection. The update owner is Neoflo Security & Privacy. Any update requires
a reviewed source change, a new policy version, renewed provenance review, and
deterministic regression coverage; it must not fetch or classify sites at
runtime.

## Review evidence and PSL provenance

On 2026-08-08, Neoflo Security & Privacy manually reviewed the following
conservative first-party seed destinations outside the runtime artifact:

| Category                        | Domain                    | Match type | Review basis                                          |
| ------------------------------- | ------------------------- | ---------- | ----------------------------------------------------- |
| authentication_account_recovery | accounts.google.com       | exact      | Google account destination                            |
| authentication_account_recovery | login.microsoftonline.com | exact      | Microsoft sign-in destination                         |
| authentication_account_recovery | account.apple.com         | exact      | Apple account destination                             |
| payments_financial              | www.paypal.com            | exact      | PayPal payment destination                            |
| payments_financial              | secure.bankofamerica.com  | suffix     | Bank of America secure destination and its subdomains |
| health                          | portal.athenahealth.com   | suffix     | athenahealth portal destination and its subdomains    |

Registrable-domain normalization is separate from this policy. It uses the
bundled, offline `tldts` package pinned at 7.0.20, with
`allowPrivateDomains: false`; its npm package metadata records the bundled PSL
distribution at source revision `793bc4d8007dd680cd97298f12ed7ebb9cb44ff5`
and MIT license. The 2026-08-08 regression fixtures cover multi-label public
suffixes, public suffixes, localhost, IP literals, a private suffix with
private domains disabled, and IDN acceptance/rejection. PSL changes require a
reviewed dependency update and deterministic fixture review.

## Consequences and residual risk

The validator fails closed for malformed policy data and the runtime artifact
does not disclose review sources. This policy is deliberately non-exhaustive:
a sensitive destination can be absent, and first-party hostnames can change.
User exclusions remain the additional user-controlled protection while policy
updates are reviewed by the named owner.
