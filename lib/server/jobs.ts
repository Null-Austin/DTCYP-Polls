import type { DB } from "./db"
import { audit, getSetting } from "./audit"
import { env } from "./env"

const DAY = 86_400_000

export function runJobs(db: DB, now = Date.now()) {
  const iso = new Date(now).toISOString()
  const ago = (days: number) => new Date(now - days * DAY).toISOString()
  db.transaction(() => {
    const opened = db
      .prepare(
        `UPDATE polls SET status = 'open', updated_at = ? WHERE status = 'draft' AND opens_at IS NOT NULL AND opens_at <= ?
         AND deleted_at IS NULL AND EXISTS (SELECT 1 FROM questions q WHERE q.poll_id = polls.id)`,
      )
      .run(iso, iso).changes
    const closed = db.prepare("UPDATE polls SET status = 'closed', updated_at = ? WHERE status = 'open' AND closes_at IS NOT NULL AND closes_at <= ?").run(iso, iso).changes
    const purged = db.prepare("DELETE FROM polls WHERE deleted_at IS NOT NULL AND deleted_at < ?").run(ago(30)).changes
    const days = Number(getSetting(db, "retention_days")) || env.retentionDays()
    const expired = db.prepare("DELETE FROM responses WHERE submitted_at < ?").run(ago(days)).changes
    db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(iso)
    if (opened || closed || purged || expired) audit(db, null, "scheduled_job", undefined, { opened, closed, purged, expired })
  })()
}
