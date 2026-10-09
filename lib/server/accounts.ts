import { timingSafeEqual } from "node:crypto"
import type { DB } from "./db"
import { nowIso } from "./db"
import { audit } from "./audit"
import { env } from "./env"
import { createSession, hashPassword, sessionCookie, timeouts, validatePassword, type User } from "./auth"
import { HttpError, str } from "./http"

export const publicUser = (u: User) => ({
  id: u.id,
  username: u.username,
  email: u.email,
  role: u.role,
  mustChangePassword: !!u.must_change_password,
})

const USERNAME = /^[A-Za-z0-9._-]{3,32}$/

export function cleanUsername(v: unknown): string {
  const u = str(v, 32, { min: 3 })
  if (!USERNAME.test(u)) throw new HttpError(400, "Username must be 3-32 letters, numbers, . _ -")
  return u
}

export function cleanEmail(v: unknown): string | null {
  if (v === undefined || v === null || v === "") return null
  const e = str(v, 200)
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new HttpError(400, "Invalid email")
  return e
}

export const setupRequired = (db: DB) => (db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n === 0

function tokenMatches(given: unknown): boolean {
  const want = env.setupToken()
  if (!want) return true
  if (typeof given !== "string") return false
  const a = Buffer.from(given)
  const b = Buffer.from(want)
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function createFirstAdmin(db: DB, body: Record<string, unknown>) {
  if (!setupRequired(db)) throw new HttpError(404, "Not found")
  if (!tokenMatches(body.setupToken)) {
    audit(db, null, "setup_token_rejected")
    throw new HttpError(403, "Setup token required")
  }
  const username = cleanUsername(body.username)
  const email = cleanEmail(body.email)
  const hash = await hashPassword(validatePassword(body.password, username))
  // Zero-users check and insert share one write transaction.
  const id = db.transaction(() => {
    if (!setupRequired(db)) throw new HttpError(404, "Not found")
    const r = db
      .prepare("INSERT INTO users (username, email, password_hash, role, must_change_password, is_root, created_at, last_login_at) VALUES (?,?,?,?,0,1,?,?)")
      .run(username, email, hash, "admin", nowIso(), nowIso())
    const rootRole = db.prepare("SELECT id FROM roles WHERE is_root = 1").get() as { id: number }
    db.prepare("INSERT INTO user_roles (user_id, role_id) VALUES (?,?)").run(Number(r.lastInsertRowid), rootRole.id)
    audit(db, Number(r.lastInsertRowid), "setup_admin", { type: "user", id: Number(r.lastInsertRowid) })
    return Number(r.lastInsertRowid)
  }).immediate()
  return id
}

export function startSession(db: DB, userId: number, extraHeaders?: Headers) {
  const s = createSession(db, userId)
  const h = extraHeaders ?? new Headers()
  h.append("Set-Cookie", sessionCookie(s.id, Math.floor(timeouts(db).maxMs / 1000)))
  return { csrf: s.csrf, headers: h }
}
