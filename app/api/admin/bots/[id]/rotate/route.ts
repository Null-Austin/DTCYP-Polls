import { route, requireHigherLevelThan } from "@/lib/server/authz"
import { HttpError, json } from "@/lib/server/http"
import { audit } from "@/lib/server/audit"
import { rotateBot } from "@/lib/server/bots"

export const POST = route<{ id: string }>({ perm: "tokens:revoke" }, ({ db, user, params }) => {
  const id = Number(params.id)
  if (!Number.isSafeInteger(id) || !db.prepare("SELECT 1 FROM bots WHERE user_id = ?").get(id)) throw new HttpError(404, "Not found")
  requireHigherLevelThan(db, user, id)
  const token = rotateBot(db, id)
  audit(db, user.id, "bot_token_rotated", { type: "bot", id })
  return json({ token, warning: "Copy this token now; it will not be shown again." })
})
