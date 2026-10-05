import { route } from "@/lib/server/authz"
import { HttpError, json } from "@/lib/server/http"
import { destroyUserSessions, generatePassword, hashPassword } from "@/lib/server/auth"
import { audit } from "@/lib/server/audit"

export const POST = route<{ id: string }>({ access: "admin" }, async ({ db, user, params }) => {
  const id = Number(params.id)
  if (!Number.isInteger(id) || !db.prepare("SELECT 1 FROM users WHERE id = ?").get(id)) throw new HttpError(404, "Not found")
  const temp = generatePassword()
  const hash = await hashPassword(temp)
  db.transaction(() => {
    db.prepare("UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?").run(hash, id)
    destroyUserSessions(db, id)
    audit(db, user.id, "user_password_reset", { type: "user", id })
  })()
  return json({ temporaryPassword: temp })
})
