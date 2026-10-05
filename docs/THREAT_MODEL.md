# Threat model

**Assets:** admin/editor accounts and sessions; link tokens (access credentials); responses; the SQLite file.
**Actors:** anonymous visitor, link holder, editor, admin, outsider scanning the server.

| Threat | Mitigation |
|---|---|
| Guessing links / probing polls | 128-bit+ CSPRNG tokens (24 chars), uniform 404, per-token rate limit |
| Double "verified" for one link | single write transaction plus partial unique index; tested with concurrent submits |
| Anyone who gets a link first can use its verified slot | **Inherent limitation.** Verification is link-only by design; revoke links or regenerate if leaked |
| Takeover of a fresh deployment | first-user check and insert in one transaction, optional `SETUP_TOKEN` |
| Password guessing | argon2id, 12+ chars, common-password list, per-username lockout, identical errors, dummy verify for unknown users |
| Session theft / fixation | httpOnly, `SameSite=Strict`, Secure (prod, `__Host-` prefix), hashed ids (HMAC with `SESSION_SECRET`), fresh id on login, idle and absolute timeouts, disabled users lose sessions |
| CSRF | per-session token header, origin and `Sec-Fetch-Site` checks, JSON-only bodies |
| IDOR / privilege escalation | one `route()` gate, `ownedPoll`/`ownedBatch`, strict field allow-lists (no mass assignment) |
| XSS | React escaping, no `dangerouslySetInnerHTML`, nonce CSP, no third-party sources |
| CSV formula injection, header injection | `csvCell`, sanitized download filenames |
| Token leakage | `Referrer-Policy: no-referrer`, no query strings in app logs, noindex; configure the reverse proxy to omit query strings from logs |
| Privacy | no IP/UA/referrer storage, time rounded to the hour, retention job, permanent delete |
| Lockout abuse | known username can be locked for 15 min; recover with the CLI reset |
