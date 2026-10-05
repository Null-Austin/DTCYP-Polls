import Database from "better-sqlite3"
import fs from "node:fs"
import path from "node:path"
import { env, sessionSecret, isProd } from "./env"
import { migrations } from "./migrations"

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

function migrate(db: DB) {
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)")
  const done = new Set(db.prepare("SELECT id FROM schema_migrations").all().map((r) => (r as { id: number }).id))
  for (const m of migrations) {
    if (done.has(m.id)) continue
    db.transaction(() => {
      db.exec(m.sql)
      db.prepare("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)").run(m.id, new Date().toISOString())
    })()
  }
}

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
