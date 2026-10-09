import { route, ownedPoll, requireOn } from "@/lib/server/authz"
import { exact, HttpError, json, readJson } from "@/lib/server/http"
import { nowIso } from "@/lib/server/db"
import { audit } from "@/lib/server/audit"

export const POST = route<{ pollid: string }>({ perm: "urls:delete" }, async ({ req, db, user, params }) => {
  const poll = ownedPoll(db, user, params.pollid)
  requireOn(db, user, "urls:delete", { pollId: poll.id, ownerId: poll.owner_id })
  const body = await readJson(req, 512)
  exact(body, ["token"])
  if (typeof body.token !== "string") throw new HttpError(400, "Invalid token")
  const r = db.prepare("UPDATE links SET revoked_at = ? WHERE token = ? AND poll_id = ? AND revoked_at IS NULL").run(nowIso(), body.token, poll.id)
  if (!r.changes) throw new HttpError(404, "Not found")
  audit(db, user.id, "link_revoked", { type: "poll", id: poll.id })
  return json({ ok: true })
})
