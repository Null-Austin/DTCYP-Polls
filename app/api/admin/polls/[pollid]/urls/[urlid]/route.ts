import { route, ownedPoll, requireOn } from "@/lib/server/authz"
import { exact, HttpError, intIn, json, readJson, str } from "@/lib/server/http"
import { audit } from "@/lib/server/audit"
import { baseUrl } from "@/lib/server/links"
import { can } from "@/lib/server/rbac"

type P = { pollid: string; urlid: string }

function getLink(db: Parameters<typeof audit>[0], pollId: string, raw: string) {
  const rowid = Number(raw)
  if (!Number.isSafeInteger(rowid) || rowid < 1) throw new HttpError(404, "Not found")
  const link = db.prepare(
    `SELECT l.rowid AS id, l.token, l.group_id AS groupId, l.display_title AS title, l.notes, l.enabled, l.revoked_at AS revokedAt, l.batch_id AS batchId,
      (SELECT COUNT(*) FROM responses r WHERE r.link_token = l.token AND r.status IN ('verified','accepted')) AS verified,
      (SELECT COUNT(*) FROM responses r WHERE r.link_token = l.token AND r.status = 'unverified') AS unverified
     FROM links l WHERE l.rowid = ? AND l.poll_id = ?`,
  ).get(rowid, pollId) as { id: number; token: string; groupId: number | null; title: string; notes: string; enabled: number; revokedAt: string | null; batchId: number; verified: number; unverified: number } | undefined
  if (!link) throw new HttpError(404, "Not found")
  return link
}

export const GET = route<P>({ perm: "urls:read" }, ({ db, user, params }) => {
  const poll = ownedPoll(db, user, params.pollid)
  const link = getLink(db, poll.id, params.urlid)
  requireOn(db, user, "urls:read", { pollId: poll.id, ownerId: poll.owner_id, groupId: link.groupId ?? undefined })
  const mayReadResponses = can(db, user, "responses:read", { pollId: poll.id, ownerId: poll.owner_id, groupId: link.groupId ?? undefined })
  return json({ ...link, verified: mayReadResponses ? link.verified : null, unverified: mayReadResponses ? link.unverified : null, url: `${baseUrl(db)}/poll/${poll.id}?t=${link.token}` })
})

export const PATCH = route<P>({ perm: "urls:edit" }, async ({ req, db, user, params }) => {
  const poll = ownedPoll(db, user, params.pollid)
  const link = getLink(db, poll.id, params.urlid)
  requireOn(db, user, "urls:edit", { pollId: poll.id, ownerId: poll.owner_id, groupId: link.groupId ?? undefined })
  const body = await readJson(req, 2048)
  exact(body, ["title", "notes", "enabled", "groupId"])
  if (body.enabled !== undefined && typeof body.enabled !== "boolean") throw new HttpError(400, "Invalid enabled state")
  const title = body.title === undefined ? link.title : str(body.title, 200, { optional: true })
  const notes = body.notes === undefined ? link.notes : str(body.notes, 2000, { optional: true })
  const enabled = body.enabled === undefined ? link.enabled : body.enabled ? 1 : 0
  let groupId = link.groupId
  if (body.groupId !== undefined) {
    groupId = body.groupId === null ? null : intIn(body.groupId, 1, 2 ** 31)
    if (groupId !== null && !db.prepare("SELECT 1 FROM distribution_groups WHERE id = ? AND poll_id = ?").get(groupId, poll.id)) throw new HttpError(404, "Not found")
    if (groupId !== null) requireOn(db, user, "groups:edit", { pollId: poll.id, ownerId: poll.owner_id, groupId })
  }
  db.transaction(() => {
    db.prepare("UPDATE links SET display_title = ?, notes = ?, enabled = ?, group_id = ? WHERE rowid = ? AND poll_id = ?")
      .run(title, notes, enabled, groupId, link.id, poll.id)
    audit(db, user.id, "url_updated", { type: "url", id: link.id }, { before: JSON.stringify({ title: link.title, enabled: !!link.enabled, groupId: link.groupId }), after: JSON.stringify({ title, enabled: !!enabled, groupId }) })
  })()
  return json({ ok: true, url: `${baseUrl(db)}/poll/${poll.id}?t=${link.token}` })
})

export const DELETE = route<P>({ perm: "urls:delete" }, ({ db, user, params }) => {
  const poll = ownedPoll(db, user, params.pollid)
  const link = getLink(db, poll.id, params.urlid)
  requireOn(db, user, "urls:delete", { pollId: poll.id, ownerId: poll.owner_id, groupId: link.groupId ?? undefined })
  const responses = link.verified + link.unverified
  if (responses) throw new HttpError(409, "This URL has responses. Disable or revoke it instead to preserve response history.")
  db.transaction(() => {
    db.prepare("DELETE FROM links WHERE rowid = ? AND poll_id = ?").run(link.id, poll.id)
    audit(db, user.id, "url_deleted", { type: "url", id: link.id }, { poll: poll.id })
  })()
  return json({ ok: true })
})
