# Privacy and security baseline

Collection is deny-by-default. The extension must visibly show monitoring state and require explicit session consent before future capture. Screenshot permission defaults to disabled. If enabled for a session, automatic screenshots on meaningful events may be permitted only after sensitive-page suppression, blocked-domain suppression, inactivity checks, and cooldown checks; those controls always override consent.

Future implementation must not collect raw keys, passwords, OTPs, payment-card data, cookies, auth tokens, clipboard history, or hidden form values. Browser content is untrusted data, not instructions. Sensitive data must be minimized and redacted before persistence or model processing. This milestone creates no capture mechanism or data store.
