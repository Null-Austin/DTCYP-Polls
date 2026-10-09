import type { DB } from "./db"
import { nowIso } from "./db"
import { auditHash } from "./audit-integrity"
import { requestContext } from "./request-context"

export type AuditResult = "success" | "denied" | "error"

// details must never contain personal data, IPs or user agents.
export function audit(
  db: DB,
  actor: number | null,
  action: string,
  target?: { type: string; id: string | number },
  details?: Record<string, string | number | boolean | null>,
  result: AuditResult = "success",
  timestamp = nowIso(),
) {
  const ctx = requestContext()
  const actorRow = actor === null ? null : (db.prepare("SELECT username, kind FROM users WHERE id = ?").get(actor) as { username: string; kind: string } | undefined)
  const actorName = actorRow ? actorRow.kind === "bot" ? actorRow.username : actorRow.username : null
  const recordIp = getSetting(db, "audit_record_ip") === "true"
  const write = db.transaction(() => {
    const previous = db.prepare("SELECT entry_hash FROM audit_log ORDER BY id DESC LIMIT 1").get() as { entry_hash: string | null } | undefined
    const id = (db.prepare("SELECT COALESCE(MAX(id), 0) + 1 AS id FROM audit_log").get() as { id: number }).id
    const row = {
      id,
      at: timestamp,
      actor_name: actorName,
      action: action.slice(0, 100),
      target_type: target?.type.slice(0, 80) ?? null,
      target_id: target ? String(target.id).slice(0, 160) : null,
      details: details ? JSON.stringify(details) : null,
      request_id: ctx?.requestId ?? null,
      ip: actor !== null && recordIp ? ctx?.ip ?? null : null,
      user_agent: actor !== null ? ctx?.userAgent ?? null : null,
      result,
      previous_hash: previous?.entry_hash ?? null,
    }
    const entryHash = auditHash(row)
    db.prepare(
      `INSERT INTO audit_log (id, at, actor_user_id, actor_name, action, target_type, target_id, details, request_id, ip, user_agent, result, previous_hash, entry_hash)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(id, row.at, actor, row.actor_name, row.action, row.target_type, row.target_id, row.details, row.request_id, row.ip, row.user_agent, row.result, row.previous_hash, entryHash)
  })
  if (db.inTransaction) write()
  else write.immediate()
}

export function getSetting(db: DB, key: string): string | undefined {
  return (db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined)?.value
}

export function setSetting(db: DB, key: string, value: string) {
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value)
}
