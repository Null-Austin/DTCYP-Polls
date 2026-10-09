import { route } from "@/lib/server/authz"
import { HttpError, json } from "@/lib/server/http"
import { destroyUserSessions, generatePassword, hashPassword } from "@/lib/server/auth"
import { audit } from "@/lib/server/audit"

export const POST = route<{ id: string }>({ root: true }, async ({ db, user, params }) => {
  const id = Number(params.id)
  const target = Number.isInteger(id) ? db.prepare("SELECT kind FROM users WHERE id = ?").get(id) as { kind: string } | undefined : undefined
  if (!target) throw new HttpError(404, "Not found")
  if (target.kind === "bot") throw new HttpError(403, "Bot accounts use API tokens, not passwords")
  const temp = generatePassword()
  const hash = await hashPassword(temp)
  db.transaction(() => {
    db.prepare("UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?").run(hash, id)
    destroyUserSessions(db, id)
    audit(db, user.id, "user_password_reset", { type: "user", id })
  })()
  return json({ temporaryPassword: temp })
})
