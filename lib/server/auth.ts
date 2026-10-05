import argon2 from "argon2"
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto"
import type { DB } from "./db"
import { nowIso } from "./db"
import { env, isProd, sessionSecret } from "./env"
import { getSetting } from "./audit"
import { HttpError } from "./http"

export type Role = "admin" | "editor"
export type User = {
  id: number
  username: string
  email: string | null
  role: Role
  must_change_password: number
  disabled_at: string | null
}
export type Session = { id: string; csrf: string; user: User }

const COMMON = new Set(
  `password1234 password12345 passwordpassword 123456789012 1234567890123 qwertyuiop12 qwertyuiopas iloveyou1234 administrator
  adminadmin123 admin1234567 letmein123456 welcome12345 welcome123456 changeme1234 changemenow12 correcthorsebatterystaple
  trustno1trustno1 monkey123456 dragon123456 football1234 baseball1234 abc123456789 password!234 p@ssw0rd1234 passw0rd1234
  1q2w3e4r5t6y 1qaz2wsx3edc qazwsxedcrfv 000000000000 111111111111 123123123123 123456123456 987654321098 asdfghjkl123`
    .split(/\s+/),
)

export function validatePassword(pw: unknown, username = ""): string {
  if (typeof pw !== "string") throw new HttpError(400, "Invalid password")
  if (pw.length < 12) throw new HttpError(400, "Password must be at least 12 characters")
  if (pw.length > 256) throw new HttpError(400, "Password is too long")
  const low = pw.toLowerCase()
  if (COMMON.has(low) || /^(.)\1+$/.test(pw) || (username && low.includes(username.toLowerCase()) && username.length >= 4)) {
    throw new HttpError(400, "That password is too easy to guess")
  }
  return pw
}

const ARGON = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const
export const hashPassword = (pw: string) => argon2.hash(pw, ARGON)

let dummy: Promise<string> | undefined
export async function verifyPassword(hash: string | null, pw: string): Promise<boolean> {
  // Unknown users still pay for one argon2 verification.
  dummy ??= hashPassword("dummy-password-for-timing")
  const h = hash ?? (await dummy)
  try {
    const ok = await argon2.verify(h, pw)
    return ok && hash !== null
  } catch {
    return false
  }
}

export const generatePassword = () => randomBytes(15).toString("base64url")

// ---- sessions ----

export const cookieName = () => (isProd() ? "__Host-sid" : "sid")

const sidHash = (id: string) => createHmac("sha256", sessionSecret()).update(id).digest("hex")

export function timeouts(db: DB) {
  const idle = Number(getSetting(db, "session_idle_minutes")) || env.idleMinutes()
  const max = Number(getSetting(db, "session_max_hours")) || env.maxHours()
  return { idleMs: idle * 60_000, maxMs: max * 3_600_000 }
}

export function createSession(db: DB, userId: number): { id: string; csrf: string } {
  const id = randomBytes(32).toString("base64url")
  const csrf = randomBytes(24).toString("base64url")
  const now = Date.now()
  const { maxMs } = timeouts(db)
  db.prepare("INSERT INTO sessions (id, user_id, csrf, created_at, expires_at, last_seen_at) VALUES (?,?,?,?,?,?)").run(
    sidHash(id),
    userId,
    csrf,
    new Date(now).toISOString(),
    new Date(now + maxMs).toISOString(),
    new Date(now).toISOString(),
  )
  return { id, csrf }
}

export function readCookie(header: string | null | undefined, name: string): string | undefined {
  if (!header) return undefined
  for (const part of header.split(";")) {
    const i = part.indexOf("=")
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim()
  }
}

export function sessionFromId(db: DB, id: string | undefined): Session | null {
  if (!id || id.length > 100) return null
  const row = db
    .prepare(
      `SELECT s.id AS sid, s.csrf, s.expires_at, s.last_seen_at, u.id, u.username, u.email, u.role, u.must_change_password, u.disabled_at
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`,
    )
    .get(sidHash(id)) as
    | (User & { sid: string; csrf: string; expires_at: string; last_seen_at: string })
    | undefined
  if (!row) return null
  const now = Date.now()
  const { idleMs } = timeouts(db)
  if (row.disabled_at || Date.parse(row.expires_at) < now || Date.parse(row.last_seen_at) + idleMs < now) {
    db.prepare("DELETE FROM sessions WHERE id = ?").run(row.sid)
    return null
  }
  if (now - Date.parse(row.last_seen_at) > 30_000) {
    db.prepare("UPDATE sessions SET last_seen_at = ? WHERE id = ?").run(nowIso(), row.sid)
  }
  const { sid, csrf, expires_at, last_seen_at, ...user } = row
  void expires_at
  void last_seen_at
  void sid
  return { id, csrf, user }
}

export function sessionFromRequest(db: DB, req: Request) {
  return sessionFromId(db, readCookie(req.headers.get("cookie"), cookieName()))
}

export function destroySession(db: DB, id: string) {
  db.prepare("DELETE FROM sessions WHERE id = ?").run(sidHash(id))
}

export function destroyUserSessions(db: DB, userId: number) {
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId)
}

export function sessionCookie(id: string | null, maxAgeSec: number): string {
  const attrs = ["Path=/", "HttpOnly", "SameSite=Strict", isProd() ? "Secure" : ""]
  return `${cookieName()}=${id ?? ""}; ${attrs.filter(Boolean).join("; ")}; Max-Age=${id ? maxAgeSec : 0}`
}

export function csrfOk(a: string, b: string | null): boolean {
  if (!b) return false
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

// ---- login lockout (memory only, keyed by username, never by IP) ----

const fails = new Map<string, { n: number; until: number }>()
const MAX_FAILS = 5
const LOCK_MS = 15 * 60_000

export const lockKey = (u: string) => u.trim().toLowerCase().slice(0, 100)

export function isLocked(u: string): boolean {
  const f = fails.get(lockKey(u))
  return !!f && f.n >= MAX_FAILS && f.until > Date.now()
}

export function recordFail(u: string) {
  const k = lockKey(u)
  const f = fails.get(k)
  if (!f || f.until < Date.now()) fails.set(k, { n: 1, until: Date.now() + LOCK_MS })
  else {
    f.n++
    if (f.n >= MAX_FAILS) f.until = Date.now() + LOCK_MS
  }
  if (fails.size > 20_000) for (const [key, v] of fails) if (v.until < Date.now()) fails.delete(key)
}

export const clearFails = (u: string) => void fails.delete(lockKey(u))
export const resetLockouts = () => fails.clear()
