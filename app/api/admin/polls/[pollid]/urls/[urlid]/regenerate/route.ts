import { randomBytes } from "node:crypto"
import { route, ownedPoll, requireOn } from "@/lib/server/authz"
import { HttpError, json } from "@/lib/server/http"
import { audit } from "@/lib/server/audit"
import { nowIso } from "@/lib/server/db"
import { baseUrl } from "@/lib/server/links"

export const POST = route<{ pollid: string; urlid: string }>({ perm: "urls:edit" }, ({ db, user, params }) => {
  const poll = ownedPoll(db, user, params.pollid)
  const id = Number(params.urlid)
  const old = Number.isSafeInteger(id) ? db.prepare("SELECT * FROM links WHERE rowid = ? AND poll_id = ?").get(id, poll.id) as {
    token: string; batch_id: number; group_id: number | null; display_title: string; notes: string; enabled: number
  } | undefined : undefined
  if (!old) throw new HttpError(404, "Not found")
  requireOn(db, user, "urls:edit", { pollId: poll.id, ownerId: poll.owner_id, groupId: old.group_id ?? undefined })
  const token = randomBytes(18).toString("base64url")
  db.transaction(() => {
    db.prepare("UPDATE links SET enabled = 0, revoked_at = ? WHERE rowid = ?").run(nowIso(), id)
    db.prepare("INSERT INTO links (token, poll_id, batch_id, created_at, group_id, display_title, notes, enabled) VALUES (?,?,?,?,?,?,?,?)")
      .run(token, poll.id, old.batch_id, nowIso(), old.group_id, old.display_title, old.notes, old.enabled)
    audit(db, user.id, "url_regenerated", { type: "url", id }, { poll: poll.id })
  })()
  return json({ url: `${baseUrl(db)}/poll/${poll.id}?t=${token}` }, 201)
})
