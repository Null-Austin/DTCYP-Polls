import { randomBytes } from "node:crypto"
import type { DB } from "./db"
import { nowIso } from "./db"
import { env, isProd } from "./env"
import { getSetting } from "./audit"
import { HttpError } from "./http"

export function baseUrl(db: DB): string {
  const u = env.publicBaseUrl() || (getSetting(db, "public_base_url") ?? "").replace(/\/+$/, "")
  if (u) return u
  if (isProd()) throw new HttpError(409, "PUBLIC_BASE_URL is not configured")
  return "http://localhost:3000"
}

export const MAX_BATCH = 10_000
const MAX_LINKS_PER_POLL = 200_000

export function createBatch(db: DB, pollId: string, count: number, label: string): number {
  return db.transaction(() => {
    const have = (db.prepare("SELECT COUNT(*) AS n FROM links WHERE poll_id = ?").get(pollId) as { n: number }).n
    if (have + count > MAX_LINKS_PER_POLL) throw new HttpError(400, "Link limit for this poll reached")
    const now = nowIso()
    const batchId = Number(db.prepare("INSERT INTO link_batches (poll_id, label, count, created_at) VALUES (?,?,?,?)").run(pollId, label, count, now).lastInsertRowid)
    const ins = db.prepare("INSERT INTO links (token, poll_id, batch_id, created_at) VALUES (?,?,?,?)")
    for (let i = 0; i < count; i++) ins.run(randomBytes(18).toString("base64url"), pollId, batchId, now)
    return batchId
  }).immediate()
}

export function linkStats(db: DB, pollId: string) {
  const one = (sql: string) => (db.prepare(sql).get(pollId) as { n: number }).n
  return {
    generated: one("SELECT COUNT(*) AS n FROM links WHERE poll_id = ?"),
    answered: one("SELECT COUNT(DISTINCT link_token) AS n FROM responses WHERE poll_id = ? AND status IN ('verified','accepted')"),
    repeats: one("SELECT COUNT(*) AS n FROM responses WHERE poll_id = ? AND status = 'unverified'"),
  }
}

export function batchList(db: DB, pollId: string) {
  return db
    .prepare(
      `SELECT b.id, b.label, b.count, b.created_at AS createdAt,
        (SELECT COUNT(*) FROM links l WHERE l.batch_id = b.id AND l.revoked_at IS NOT NULL) AS revoked,
        (SELECT COUNT(*) FROM responses r JOIN links l ON l.token = r.link_token WHERE l.batch_id = b.id AND r.status IN ('verified','accepted')) AS verified,
        (SELECT COUNT(*) FROM responses r JOIN links l ON l.token = r.link_token WHERE l.batch_id = b.id AND r.status = 'unverified') AS unverified
       FROM link_batches b WHERE b.poll_id = ? ORDER BY b.id DESC LIMIT 200`,
    )
    .all(pollId)
}
