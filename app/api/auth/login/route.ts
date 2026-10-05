import { route } from "@/lib/server/authz"
import { exact, HttpError, json, rateLimit, readJson } from "@/lib/server/http"
import { publicUser, startSession } from "@/lib/server/accounts"
import { clearFails, destroySession, isLocked, readCookie, cookieName, recordFail, verifyPassword, type User } from "@/lib/server/auth"
import { audit } from "@/lib/server/audit"
import { nowIso } from "@/lib/server/db"

export const POST = route({ access: "public" }, async ({ req, db }) => {
  if (!rateLimit("login", 300, 5 * 60_000)) throw new HttpError(429, "Too many attempts. Try again later.")
  const body = await readJson(req, 4096)
  exact(body, ["username", "password"])
  const username = typeof body.username === "string" ? body.username.slice(0, 100) : ""
  const password = typeof body.password === "string" ? body.password.slice(0, 256) : ""
  if (isLocked(username)) {
    const u = db.prepare("SELECT id FROM users WHERE username = ?").get(username) as { id: number } | undefined
    audit(db, null, "login_blocked_locked", u ? { type: "user", id: u.id } : undefined)
    throw new HttpError(429, "Too many attempts. Try again later.")
  }

  const row = db
    .prepare("SELECT id, username, email, role, must_change_password, disabled_at, password_hash FROM users WHERE username = ?")
    .get(username) as (User & { password_hash: string }) | undefined
  const ok = await verifyPassword(row?.password_hash ?? null, password)
  if (!ok || !row || row.disabled_at) {
    recordFail(username)
    audit(db, null, "login_failed", row ? { type: "user", id: row.id } : undefined)
    throw new HttpError(401, "Invalid username or password")
  }
  clearFails(username)
  // Never reuse a presented session id (fixation).
  const old = readCookie(req.headers.get("cookie"), cookieName())
  if (old) destroySession(db, old)
  db.prepare("UPDATE users SET last_login_at = ? WHERE id = ?").run(nowIso(), row.id)
  audit(db, row.id, "login", { type: "user", id: row.id })
  const { csrf, headers } = startSession(db, row.id)
  return json({ user: publicUser(row), csrf }, 200, headers)
})
