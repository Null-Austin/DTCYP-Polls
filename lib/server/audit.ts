import type { DB } from "./db"
import { nowIso } from "./db"

// details must never contain personal data, IPs or user agents.
export function audit(
  db: DB,
  actor: number | null,
  action: string,
  target?: { type: string; id: string | number },
  details?: Record<string, string | number | boolean | null>,
) {
  db.prepare(
    "INSERT INTO audit_log (at, actor_user_id, action, target_type, target_id, details) VALUES (?,?,?,?,?,?)",
  ).run(nowIso(), actor, action, target?.type ?? null, target ? String(target.id) : null, details ? JSON.stringify(details) : null)
}

export function getSetting(db: DB, key: string): string | undefined {
  return (db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined)?.value
}

export function setSetting(db: DB, key: string, value: string) {
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value)
}
