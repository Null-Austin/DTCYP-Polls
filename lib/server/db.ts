import Database from "better-sqlite3"
import fs from "node:fs"
import path from "node:path"
import { env, sessionSecret, isProd } from "./env"
import { migrations as ALL, type Migration } from "./migrations"

export type DB = Database.Database

export function openDb(file: string): DB {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true })
  const db = new Database(file)
  db.pragma("journal_mode = WAL")
  db.pragma("foreign_keys = ON")
  db.pragma("busy_timeout = 5000")
  migrate(db)
  return db
}

export const backupDir = (db: DB) => path.join(path.dirname(db.name), "backups")

export function appliedIds(db: DB): number[] {
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)")
  return (db.prepare("SELECT id FROM schema_migrations ORDER BY id").all() as { id: number }[]).map((r) => r.id)
}

// Each migration runs in its own transaction; a failure rolls that one back and rethrows.
// Before the first pending migration on an existing database, a consistent copy is written to <db dir>/backups.
export function migrate(db: DB, list: Migration[] = ALL, opts: { backup?: boolean } = {}): { applied: number[]; backup?: string } {
  const done = new Set(appliedIds(db))
  const pending = list.filter((m) => !done.has(m.id)).sort((a, b) => a.id - b.id)
  const result: { applied: number[]; backup?: string } = { applied: [] }
  if (!pending.length) return result
  if (done.size > 0 && db.name !== ":memory:" && opts.backup !== false) {
    const dir = backupDir(db)
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, `pre-migration-v${Math.max(...done)}-to-v${pending[pending.length - 1].id}-${Date.now()}.db`)
    db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`)
    result.backup = file
  }
  for (const m of pending) {
    db.transaction(() => {
      db.exec(m.sql)
      m.run?.(db)
      db.prepare("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)").run(m.id, new Date().toISOString())
    })()
    result.applied.push(m.id)
  }
  return result
}

// Best-effort reversal down to (and not including) `toId`. Only for emergencies and tests.
export function rollback(db: DB, toId: number, list: Migration[] = ALL) {
  for (const m of [...list].sort((a, b) => b.id - a.id)) {
    if (m.id <= toId || !appliedIds(db).includes(m.id)) continue
    if (!m.down) throw new Error(`Migration ${m.id} has no down step`)
    db.transaction(() => {
      db.exec(m.down!)
      db.prepare("DELETE FROM schema_migrations WHERE id = ?").run(m.id)
    })()
  }
}

export const schemaVersion = (db: DB) => Math.max(0, ...appliedIds(db))

const g = globalThis as unknown as { __pollDb?: { file: string; db: DB } }

export function getDb(): DB {
  const file = env.databasePath()
  if (g.__pollDb && g.__pollDb.file === file) return g.__pollDb.db
  if (isProd()) sessionSecret() // fail fast on a bad secret
  g.__pollDb?.db.close()
  g.__pollDb = { file, db: openDb(file) }
  return g.__pollDb.db
}

export function closeDb() {
  g.__pollDb?.db.close()
  g.__pollDb = undefined
}

export const nowIso = () => new Date().toISOString()
