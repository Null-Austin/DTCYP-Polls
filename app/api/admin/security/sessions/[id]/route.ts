import { route, requireHigherLevelThan } from "@/lib/server/authz"
import { HttpError, json } from "@/lib/server/http"
import { audit } from "@/lib/server/audit"

type P = { id: string }

export const DELETE = route<P>({ perm: "admin:security" }, ({ db, user, params }) => {
  const id = Number(params.id)
  const s = Number.isSafeInteger(id) ? db.prepare("SELECT rowid AS id, user_id AS userId FROM sessions WHERE rowid = ?").get(id) as { id: number; userId: number } | undefined : undefined
  if (!s) throw new HttpError(404, "Not found")
  requireHigherLevelThan(db, user, s.userId)
  db.prepare("DELETE FROM sessions WHERE rowid = ?").run(s.id)
  audit(db, user.id, "session_revoked", { type: "user", id: s.userId })
  return json({ ok: true })
})
