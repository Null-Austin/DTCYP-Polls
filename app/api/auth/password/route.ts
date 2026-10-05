import { route } from "@/lib/server/authz"
import { exact, HttpError, json, rateLimit, readJson } from "@/lib/server/http"
import { destroyUserSessions, hashPassword, validatePassword, verifyPassword } from "@/lib/server/auth"
import { startSession } from "@/lib/server/accounts"
import { audit } from "@/lib/server/audit"

export const POST = route({ access: "user", allowMustChange: true }, async ({ req, db, user }) => {
  if (!rateLimit(`pw:${user.id}`, 10, 15 * 60_000)) throw new HttpError(429, "Too many attempts")
  const body = await readJson(req, 4096)
  exact(body, ["current", "next"])
  const row = db.prepare("SELECT password_hash FROM users WHERE id = ?").get(user.id) as { password_hash: string }
  if (typeof body.current !== "string" || !(await verifyPassword(row.password_hash, body.current))) {
    audit(db, user.id, "password_change_failed", { type: "user", id: user.id })
    throw new HttpError(400, "Current password is incorrect")
  }
  const next = validatePassword(body.next, user.username)
  if (next === body.current) throw new HttpError(400, "Choose a different password")
  const hash = await hashPassword(next)
  db.prepare("UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?").run(hash, user.id)
  destroyUserSessions(db, user.id)
  audit(db, user.id, "password_changed", { type: "user", id: user.id })
  const { csrf, headers } = startSession(db, user.id)
  return json({ ok: true, csrf }, 200, headers)
})
