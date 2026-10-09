# Roles and Administration Overhaul Plan

## Existing architecture found

- Next.js 16 App Router, React 19, TypeScript, `better-sqlite3`, argon2id, Vitest; production runs with `next start`.
- `lib/server/db.ts` opens SQLite with WAL and foreign keys. `lib/server/migrations.ts` holds the numbered migrations; migration 1 is the poll/auth schema and migration 2 adds `poll_shares`.
- `users.role` (`admin|editor`) and the legacy `ownedPoll` helper were the original authorization model. Route handlers live under `app/api/**`; pages are under `app/admin/**`; shared UI is in `components/admin/**`.
- `link_batches` represent generated-link batches; there is no separate distribution-group model yet. Individual `links` have opaque tokens, and `responses` are tied to those tokens.
- Audit rows are inserted through `lib/server/audit.ts`; they do not yet have an integrity chain. API routes return JSON from a common handler wrapper.
- Baseline before this task: `npx tsc --noEmit` passed, `npx eslint .` passed, `npx vitest run` passed 35 tests, `npm run build` completed with 0 warning/error matches.

## Implementation order

1. **Migrations and backup:** preserve versions 1 and 2, add roles, multiple role assignments, grants, bots and root protection; automatic `VACUUM INTO` before pending migrations; old-schema fixture verifies row preservation, idempotence, backup and rollback.
2. **Roles and permissions:** central catalog; rootadmin, Admin, Editor; union permissions and max effective level; strict hierarchy helper; exact permission checks at route and resource level; root-only password reset; role and assignment UI.
3. **Distribution groups and URLs:** extend link batches and links into manageable groups/URLs, bulk title parsing, clipboard/export and permission checks.
4. **Audit:** append-only, richer actor/action/result/request context, hash-chain verification and filtering/export.
5. **Bots and API:** one-time bot tokens stored hashed, bearer auth, expiry/rotation/revocation, `/api/v1/me/permissions`, OpenAPI and permission-gated docs.
6. **Site administration:** permission-based Admin hub/navigation, settings, security/system/backup/export/webhook surfaces. No impersonation feature.
7. **Verification:** typecheck, lint, full tests, production build, running-app smoke tests; document incomplete or unverified surfaces explicitly.

## Privacy and scope decisions

- The normal UI/API cannot transfer rootadmin. A server-side operator process could be added later, but there is no transfer route.
- Client IP capture is disabled unless an operator explicitly configures `CLIENT_IP_HEADER`; user-agent is not persisted. Link tokens and passwords are never included in audit details.
- Existing tracked answers remain attached to polls and link tokens. Admin powers are permission-scoped; response data stays behind `responses:read`/`responses:export` checks.
- Existing poll URLs remain `/poll/{id}?t={token}`. Existing batch exports remain available while the group management interface grows around `link_batches`.
- Email is not sent by the current product, so SMTP settings are out of scope.
- A portable export-archive restore is deferred in favor of database backup restore; a full streaming ZIP/encryption path is not yet implemented.
