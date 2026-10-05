# DTCYP Polls

Simple polls with many unique links per poll. The first answer per link is `verified`; later ones are saved as `unverified`. See [AGENTS.md](AGENTS.md) for the rules, [docs/](docs) for the plan, threat model and security review.

## Run
```bash
cp .env.example .env.local   # set SESSION_SECRET for production
npm install
npm run dev                  # http://localhost:3000/login creates the first admin
npm run seed                 # optional sample poll with 5 links (needs an admin first)
```

Production: `npm run build && npm start` with `SESSION_SECRET` (32+ chars), `PUBLIC_BASE_URL`, `DATABASE_PATH`. Run behind HTTPS and make the reverse proxy omit IPs and query strings from access logs (link tokens live in the query string). Back up the SQLite file (`data/polls.db`, plus `-wal`/`-shm`) with `sqlite3 .backup` or a stopped copy.

## Commands
`npm test`, `npm run lint`, `npm run typecheck`, `npm run reset-admin -- <username>` (prints a temporary password and re-enables the account).

## Known limitations
Anyone who gets a link first can use its verified slot. Lockout and rate limits are in memory (single instance). See [docs/SECURITY_REVIEW.md](docs/SECURITY_REVIEW.md).
