# Plan

## Assumptions
- The existing app is Next.js 16 (App Router), not React + Express, so the "server" is Next Route Handlers on `next start`. SQLite via `better-sqlite3`, hashing via `argon2` (argon2id).
- Pages and `/test` are dynamic (needed for CSP nonces). `/test/*` is dev-only (404 in production via `proxy.ts`). This is a change to `/test`; `/test/[token]` was broken and now renders a preview of the shared `PollForm`.
- A poll without "require verification" stores responses with status `accepted` so the partial unique index (`UNIQUE(link_token) WHERE status='verified'`) never blocks them. Results count `accepted` as verified.
- Sidebar is Dashboard, Polls, Users, Audit log, Settings. Links and Results live as tabs on each poll (they are per-poll pages).
- Rate limiting and lockout are in memory and keyed by username / global bucket (never by IP). Consequence: an attacker can temporarily lock a known username (15 min).
- Rating answers are stored as text "1".."5".
- The design screenshots could not be saved by the tooling; the UI follows them from the image (dark admin, purple accent, success green, warning yellow). Add them to `docs/design/` if wanted.

## Layout
```
proxy.ts, instrumentation.ts
lib/server  env db migrations audit auth accounts authz http polls poll-actions links results jobs page-auth
lib/client  api use-load
app/api     auth/*  polls/[pollid]{,/responses}  admin/*
app         login  poll/[pollid]  admin/**  test/**
components  poll/{poll-form,public-poll}  admin/*
scripts     seed.ts reset-admin.ts
tests       api.test.ts helpers.ts
```

## Migrations
1. `001`: users, sessions, polls, questions, options, link_batches, links, responses (+ partial unique index), answers, audit_log, settings.

## API
| Route | Access | Notes |
|---|---|---|
| GET /api/auth/status | public | `{setupRequired}` |
| POST /api/auth/setup | public | 404 once any user exists; `SETUP_TOKEN` if set |
| POST /api/auth/login, logout (`?all=1`), password; GET me | session | fresh session on login, CSRF on writes |
| GET /api/polls/{id}?t= | public | uniform 404 |
| POST /api/polls/{id}/responses | public | one transaction decides verified/unverified |
| GET/POST /api/admin/polls, POST bulk | user | editors scoped to own |
| GET/PATCH/DELETE /api/admin/polls/{id}, POST action | user | structure locked once responses exist |
| GET/POST /api/admin/polls/{id}/links, POST links/revoke | user | 1..10000 per batch |
| GET /api/admin/batches/{id}/export, POST revoke | user | CSV / TXT |
| GET /api/admin/polls/{id}/results (+/export) | user | verified vs unverified |
| users CRUD, reset-password, audit, settings | admin | last admin protected |
| GET /api/admin/dashboard | user | scoped |
