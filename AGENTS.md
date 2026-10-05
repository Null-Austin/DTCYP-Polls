<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# DTCYP Polls: what this app is

A deliberately simple polling site. One poll has many unique links; every link opens the same poll. We track the link, never the person.

- First answer per link is saved as `verified`, later answers with the same link as `unverified` (kept, never overwriting the first). Polls with "require verification" off store every answer as `accepted`, which results treat as verified. Verification depends only on the link token: no IP, cookie or fingerprint, ever.
- Respondents are never told whether they were verified. They only see a notice that a link was already used.
- The homepage is intentionally bare (just the logo). Do not add details to it.

## Stack and layout
- Next.js App Router, Route Handlers under `app/api/**`, `better-sqlite3` (WAL, foreign keys, versioned migrations in `lib/server/migrations.ts`, append-only), `argon2` (argon2id). Tests: Vitest (`npm test`).
- `lib/server/*`: all server logic (use relative imports so `tsx` scripts work). `lib/client/*`: fetch helper (CSRF header) and `useLoad`.
- `proxy.ts`: CSP nonce + security headers; 404s `/test/*` in production. `instrumentation.ts`: 60s job loop (`lib/server/jobs.ts`: scheduling, 30-day trash purge, response retention, session cleanup).
- Public: `/poll/{pollid}?t={token}` (shared `components/poll/poll-form.tsx` is also the editor preview), `/login` (first-run admin setup appears only while zero users exist).
- Admin (session required, server layout re-checks): `/admin`, `/admin/polls`, `/admin/{pollid}/edit|links|results`, `/admin/users|audit|settings` (admin only), `/admin/account`.

## Rules to keep
- Every API route is wrapped in `route({ access }, handler)` from `lib/server/authz.ts` (401 no session, 403 forbidden, CSRF token + origin check on writes). Poll/batch access goes through `ownedPoll` / `ownedBatch` (editors only reach their own; others look like 404).
- Public poll failures (bad token, wrong poll, revoked, trashed) all return the same 404.
- Parse request bodies with `readJson` + `exact(...)` (size cap, unknown fields rejected). Parameterise SQL; only whitelisted fragments may be interpolated.
- Store no IPs, user agents, referrers or precise times. Submission time is rounded to the hour; device is `mobile|desktop`; language is a 2-letter code. Never log tokens or query strings.
- Export URLs use `PUBLIC_BASE_URL` (or the admin setting), never the Host header. CSV cells go through `csvCell`.
- Production refuses to start without a 32+ char `SESSION_SECRET`. See `.env.example`.
- Commands: `npm run dev|build|test|lint|typecheck`, `npm run seed`, `npm run reset-admin -- <username>`.
