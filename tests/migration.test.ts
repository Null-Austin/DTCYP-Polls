import { mkdtempSync, existsSync, readdirSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import Database from "better-sqlite3"
import { describe, expect, it } from "vitest"
import { migrate, rollback, appliedIds, type DB } from "@/lib/server/db"
import { migrations, type Migration } from "@/lib/server/migrations"

const OLD = migrations.filter((m) => m.id <= 2)
const tmp = () => path.join(mkdtempSync(path.join(tmpdir(), "mig-")), "old.db")

// Builds a database exactly as the previous release would have left it, with realistic data.
function oldDatabase(): { file: string; db: DB; counts: Record<string, number> } {
  const file = tmp()
  const db = new Database(file)
  db.pragma("journal_mode = WAL")
  db.pragma("foreign_keys = ON")
  migrate(db, OLD)
  const now = "2026-01-01T00:00:00.000Z"
  const u = db.prepare("INSERT INTO users (username, email, password_hash, role, must_change_password, created_at) VALUES (?,?,?,?,0,?)")
  u.run("founder", null, "$argon2id$x", "admin", now)
  u.run("admin2", "a2@example.org", "$argon2id$x", "admin", now)
  u.run("editor1", null, "$argon2id$x", "editor", now)
  u.run("editor2", null, "$argon2id$x", "editor", now)
  db.prepare("INSERT INTO polls (id, title, owner_id, status, created_at, updated_at) VALUES (?,?,?,?,?,?)").run("lunch", "Lunch", 3, "open", now, now)
  db.prepare("INSERT INTO polls (id, title, owner_id, status, created_at, updated_at) VALUES (?,?,?,?,?,?)").run("other", "Other", 4, "draft", now, now)
  db.prepare("INSERT INTO questions (poll_id, prompt, type, required, position) VALUES ('lunch','Pick','single',1,0)").run()
  db.prepare("INSERT INTO options (question_id, label, position) VALUES (1,'A',0),(1,'B',1)").run()
  db.prepare("INSERT INTO link_batches (poll_id, label, count, created_at) VALUES ('lunch','b1',3,?)").run(now)
  for (const t of ["tok-aaaaaaaaaaaaaaaaaa", "tok-bbbbbbbbbbbbbbbbbb", "tok-cccccccccccccccccc"]) {
    db.prepare("INSERT INTO links (token, poll_id, batch_id, created_at) VALUES (?, 'lunch', 1, ?)").run(t, now)
  }
  db.prepare("INSERT INTO responses (poll_id, link_token, status, submitted_at, device_class, language) VALUES ('lunch','tok-aaaaaaaaaaaaaaaaaa','verified',?, 'desktop','en')").run(now)
  db.prepare("INSERT INTO responses (poll_id, link_token, status, submitted_at, device_class, language) VALUES ('lunch','tok-aaaaaaaaaaaaaaaaaa','unverified',?, 'mobile','fr')").run(now)
  db.prepare("INSERT INTO answers (response_id, question_id, option_id) VALUES (1,1,1),(2,1,2)").run()
  db.prepare("INSERT INTO poll_shares (poll_id, user_id, permission, created_at) VALUES ('lunch', 4, 'view', ?)").run(now)
  db.prepare("INSERT INTO audit_log (at, actor_user_id, action) VALUES (?,1,'login')").run(now)
  db.prepare("INSERT INTO settings (key, value) VALUES ('retention_days','30')").run()
  const counts: Record<string, number> = {}
  for (const t of ["users", "polls", "questions", "options", "link_batches", "links", "responses", "answers", "poll_shares", "audit_log", "settings", "sessions"]) {
    counts[t] = (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n
  }
  return { file, db, counts }
}

describe("migration from the old schema", () => {
  it("keeps every row, maps roles, makes the original admin rootadmin, and takes a backup first", () => {
    const { file, db, counts } = oldDatabase()
    const res = migrate(db)
    expect(res.applied).toEqual([3, 4, 5, 6, 7, 8, 9])
    for (const [t, n] of Object.entries(counts)) {
      expect((db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n, t).toBe(n)
    }
    const roleOf = (name: string) =>
      (db.prepare("SELECT r.name FROM user_roles ur JOIN roles r ON r.id = ur.role_id JOIN users u ON u.id = ur.user_id WHERE u.username = ?").all(name) as { name: string }[]).map((r) => r.name)
    expect(roleOf("founder")).toEqual(["rootadmin"])
    expect(roleOf("admin2")).toEqual(["Admin"])
    expect(roleOf("editor1")).toEqual(["Editor"])
    expect(roleOf("editor2")).toEqual(["Editor"])
    expect((db.prepare("SELECT username FROM users WHERE is_root = 1").all() as { username: string }[]).map((r) => r.username)).toEqual(["founder"])
    const roles = db.prepare("SELECT name, level, is_root FROM roles ORDER BY position").all()
    expect(roles).toEqual([{ name: "rootadmin", level: 255, is_root: 1 }, { name: "Admin", level: 200, is_root: 0 }, { name: "Editor", level: 50, is_root: 0 }])

    // pre-migration backup exists, opens, and still has the old schema with all the data
    expect(res.backup && existsSync(res.backup)).toBe(true)
    const b = new Database(res.backup!, { readonly: true })
    expect(b.prepare("SELECT COUNT(*) AS n FROM users").get()).toEqual({ n: counts.users })
    expect(b.prepare("SELECT name FROM sqlite_master WHERE name = 'roles'").get()).toBeUndefined()
    b.close()
    expect(readdirSync(path.join(path.dirname(file), "backups")).length).toBe(1)
  })

  it("is idempotent: running again changes nothing and makes no second backup", () => {
    const { file, db } = oldDatabase()
    migrate(db)
    const before = JSON.stringify(db.prepare("SELECT * FROM user_roles ORDER BY 1,2").all())
    const again = migrate(db)
    expect(again).toEqual({ applied: [] })
    expect(JSON.stringify(db.prepare("SELECT * FROM user_roles ORDER BY 1,2").all())).toBe(before)
    expect(readdirSync(path.join(path.dirname(file), "backups")).length).toBe(1)
    expect(db.prepare("SELECT COUNT(*) AS n FROM roles").get()).toEqual({ n: 3 })
  })

  it("a failing migration rolls back completely and leaves the database usable", () => {
    const { db, counts } = oldDatabase()
    const bad: Migration = {
      id: 10,
      name: "bad",
      sql: "CREATE TABLE half_done (x INTEGER); INSERT INTO half_done VALUES (1);",
      run: () => {
        throw new Error("boom")
      },
    }
    expect(() => migrate(db, [...migrations, bad])).toThrow("boom")
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'half_done'").get()).toBeUndefined()
    expect(appliedIds(db)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]) // earlier migrations commit; the failing migration does not
    expect((db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n).toBe(counts.users)

    // a failure inside migration 3 itself leaves the old schema intact
    const old = oldDatabase()
    const broken: Migration[] = [...OLD, { ...migrations[2], run: () => { throw new Error("mid-way") } }]
    expect(() => migrate(old.db, broken)).toThrow("mid-way")
    expect(appliedIds(old.db)).toEqual([1, 2])
    expect(old.db.prepare("SELECT name FROM sqlite_master WHERE name IN ('roles','bots','user_roles')").all()).toEqual([])
    expect(old.db.prepare("PRAGMA table_info(users)").all().map((c) => (c as { name: string }).name)).not.toContain("is_root")
    expect(migrate(old.db).applied).toEqual([3, 4, 5, 6, 7, 8, 9]) // and a later good run succeeds
  })

  it("can be rolled back and re-applied", () => {
    const { db } = oldDatabase()
    migrate(db)
    rollback(db, 2)
    expect(appliedIds(db)).toEqual([1, 2])
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'roles'").get()).toBeUndefined()
    expect(migrate(db, migrations, { backup: false }).applied).toEqual([3, 4, 5, 6, 7, 8, 9])
    expect(db.prepare("SELECT username FROM users WHERE is_root = 1").get()).toEqual({ username: "founder" })
  })

  it("fresh databases get the default roles and no rootadmin user yet", () => {
    const db = new Database(":memory:")
    db.pragma("foreign_keys = ON")
    migrate(db)
    expect((db.prepare("SELECT name FROM roles ORDER BY position").all() as { name: string }[]).map((r) => r.name)).toEqual(["rootadmin", "Admin", "Editor"])
    expect(db.prepare("SELECT COUNT(*) AS n FROM users").get()).toEqual({ n: 0 })
  })

  it("the database itself enforces the 255 cap, one root role/user, and root role protection", () => {
    const { db } = oldDatabase()
    migrate(db)
    const now = "2026-01-01T00:00:00.000Z"
    const ins = db.prepare("INSERT INTO roles (name, level, position, is_root, created_at) VALUES (?,?,?,?,?)")
    expect(() => ins.run("too-high", 256, 9, 0, now)).toThrow()
    expect(() => ins.run("negative", -1, 9, 0, now)).toThrow()
    expect(() => ins.run("fake-root", 255, 9, 1, now)).toThrow() // second root role
    expect(() => db.prepare("UPDATE roles SET name = 'x' WHERE is_root = 1").run()).toThrow(/protected/)
    expect(() => db.prepare("UPDATE roles SET level = 10 WHERE is_root = 1").run()).toThrow(/protected/)
    expect(() => db.prepare("DELETE FROM roles WHERE is_root = 1").run()).toThrow(/protected/)
    expect(() => db.prepare("DELETE FROM role_permissions WHERE role_id = (SELECT id FROM roles WHERE is_root = 1)").run()).toThrow(/protected/)
    expect(() => db.prepare("UPDATE users SET is_root = 0 WHERE username = 'founder'").run()).toThrow(/protected/)
    expect(() => db.prepare("DELETE FROM users WHERE username = 'founder'").run()).toThrow(/protected/)
    expect(() => db.prepare("UPDATE users SET is_root = 1 WHERE username = 'admin2'").run()).toThrow() // second root user
    expect(() => db.prepare("UPDATE roles SET color = 'red' WHERE name = 'Editor'").run()).toThrow()
  })
})
