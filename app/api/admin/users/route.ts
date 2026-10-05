import { route } from "@/lib/server/authz"
import { exact, HttpError, json, readJson } from "@/lib/server/http"
import { cleanEmail, cleanUsername } from "@/lib/server/accounts"
import { generatePassword, hashPassword } from "@/lib/server/auth"
import { audit } from "@/lib/server/audit"
import { nowIso } from "@/lib/server/db"

export const GET = route({ access: "admin" }, ({ db }) =>
  json({
    users: db
      .prepare(
        `SELECT id, username, email, role, must_change_password AS mustChangePassword, disabled_at AS disabledAt,
          created_at AS createdAt, last_login_at AS lastLoginAt FROM users ORDER BY username COLLATE NOCASE`,
      )
      .all(),
  }),
)

export const POST = route({ access: "admin" }, async ({ req, db, user }) => {
  const body = await readJson(req, 2048)
  exact(body, ["username", "email", "role"])
  const username = cleanUsername(body.username)
  const email = cleanEmail(body.email)
  if (body.role !== "admin" && body.role !== "editor") throw new HttpError(400, "Invalid role")
  if (db.prepare("SELECT 1 FROM users WHERE username = ?").get(username)) throw new HttpError(409, "Username taken")
  const temp = generatePassword()
  const hash = await hashPassword(temp)
  const id = db.transaction(() => {
    const r = db
      .prepare("INSERT INTO users (username, email, password_hash, role, must_change_password, created_at) VALUES (?,?,?,?,1,?)")
      .run(username, email, hash, body.role as string, nowIso())
    audit(db, user.id, "user_created", { type: "user", id: Number(r.lastInsertRowid) }, { role: body.role as string })
    return Number(r.lastInsertRowid)
  })()
  return json({ id, temporaryPassword: temp }, 201)
})
