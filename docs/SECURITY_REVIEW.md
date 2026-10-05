# Security review

Scope: own code, reviewed after the build. "Verified by test" means an assertion in `tests/api.test.ts` passed (31 tests). "Verified manually" means checked against a running `next start`.

| Area | Result |
|---|---|
| Verified/unverified, concurrency, accepted mode | Verified by test (also DB-level unique index) |
| Uniform 404 (wrong poll, bad/revoked token, trashed) | Verified by test (identical bodies) |
| 401 on every admin route without session; editor 403/404 on admin-only and others' polls | Verified by test |
| Setup once, concurrent setup, `SETUP_TOKEN`, weak passwords | Verified by test |
| Lockout, identical login errors, idle expiry, disabled user, forced password change | Verified by test |
| CSRF, cross-origin, form content type | Verified by test |
| Mass assignment, reserved/malformed slugs, last-admin protection | Verified by test |
| Export: N unique URLs from `PUBLIC_BASE_URL` (Host ignored), CSV formula neutralized | Verified by test |
| No IP/UA/referrer in DB or audit log | Verified by test and schema column check |
| Admin-only full export (`/api/admin/export`): 401 anonymous, 403 editor, no password hashes, audited | Verified by test. The file holds link tokens and all response fields, so treat it as sensitive |
| Audit trail: logins, failures, lockouts, denied access (path only), exports, result views, setting keys | Verified by test |
| CSP nonce, security headers, `/test` 404, `/admin` redirect, no request logging, hydration under CSP | Verified manually (production build) |
| SQL injection | All user values parameterized; the only interpolated fragments are constants or whitelisted (sort columns). Checked by grep |
| XSS | No `dangerouslySetInnerHTML` in app code (grep). Rendering of hostile strings is not covered by an automated test |
| Dependencies | `npm audit --omit=dev`: 0 vulnerabilities. Dev tooling reports `braces` (high, DoS, dev-only) |

## Known gaps and limitations
- Rate limits and lockout are in memory: reset on restart, per process. Not suitable for multiple instances.
- Cookie is `Secure` only in production; run behind HTTPS. HSTS is sent in production.
- `X-Forwarded-*` is never trusted. Origin check uses the `Host` header or `PUBLIC_BASE_URL`.
- Responses table keeps `link_token`; anyone with DB access can see which link answered (no names are ever stored).
- Audit log has no automatic retention.
- Not tested: real-browser drag-and-drop, XSS rendering, multi-process races, load.
- No second "fix" pass was needed beyond the changes made during the build (username min length and password rules surfaced by tests).
