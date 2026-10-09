import { route, ownedPoll, requireOn } from "@/lib/server/authz"
import { can } from "@/lib/server/rbac"
import { exact, HttpError, json, readJson } from "@/lib/server/http"
import { baseUrl } from "@/lib/server/links"

export const GET = route<{ pollid: string; groupid: string }>({ perm: "urls:read" }, ({ db, user, params, url }) => {
  const poll = ownedPoll(db, user, params.pollid)
  const groupId = Number(params.groupid)
  const group = Number.isInteger(groupId) ? db.prepare("SELECT id FROM distribution_groups WHERE id = ? AND poll_id = ?").get(groupId, poll.id) : null
  if (!group) throw new HttpError(404, "Not found")
  const resource = { pollId: poll.id, ownerId: poll.owner_id, groupId }
  requireOn(db, user, "urls:read", resource)
  const q = (url.searchParams.get("q") ?? "").slice(0, 100).replace(/[\\%_]/g, "\\$&")
  const status = url.searchParams.get("status")
  const page = Math.max(0, Math.min(100_000, Number(url.searchParams.get("page")) || 0))
  const where = ["l.group_id = ?", "l.poll_id = ?"]
  const args: (string | number)[] = [groupId, poll.id]
  if (q) {
    where.push("(l.display_title LIKE ? ESCAPE '\\' OR l.token LIKE ? ESCAPE '\\')")
    args.push(`%${q}%`, `%${q}%`)
  }
  if (status === "enabled") where.push("l.enabled = 1 AND l.revoked_at IS NULL")
  if (status === "disabled") where.push("(l.enabled = 0 OR l.revoked_at IS NOT NULL)")
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM links l WHERE ${where.join(" AND ")}`).get(...args) as { n: number }).n
  const links = db.prepare(
    `SELECT l.rowid AS id, l.token, l.group_id AS groupId, l.display_title AS title, l.notes, l.enabled, l.revoked_at AS revokedAt,
      CASE WHEN ? = 1 THEN (SELECT COUNT(*) FROM responses r WHERE r.link_token = l.token AND r.status IN ('verified','accepted')) ELSE NULL END AS verified,
      CASE WHEN ? = 1 THEN (SELECT COUNT(*) FROM responses r WHERE r.link_token = l.token AND r.status = 'unverified') ELSE NULL END AS unverified
     FROM links l WHERE ${where.join(" AND ")} ORDER BY l.rowid LIMIT 200 OFFSET ?`,
  ).all(can(db, user, "responses:read", resource) ? 1 : 0, can(db, user, "responses:read", resource) ? 1 : 0, ...args, page * 200) as { id: number; token: string; groupId: number | null; title: string; notes: string; enabled: number; revokedAt: string | null; verified: number | null; unverified: number | null }[]
  const base = baseUrl(db)
  return json({ page, pageSize: 200, total, urls: links.map((l) => ({ ...l, url: `${base}/poll/${poll.id}?t=${l.token}` })) })
})

export const POST = route<{ pollid: string; groupid: string }>({ perm: "urls:export" }, async ({ req, db, user, params }) => {
  const poll = ownedPoll(db, user, params.pollid)
  const groupId = Number(params.groupid)
  if (!Number.isInteger(groupId) || !db.prepare("SELECT 1 FROM distribution_groups WHERE id = ? AND poll_id = ?").get(groupId, poll.id)) throw new HttpError(404, "Not found")
  requireOn(db, user, "urls:export", { pollId: poll.id, ownerId: poll.owner_id, groupId })
  const body = await readJson(req, 32 * 1024)
  exact(body, ["ids"])
  let rows: { token: string }[]
  if (body.ids !== undefined) {
    if (!Array.isArray(body.ids) || body.ids.length < 1 || body.ids.length > 10_000 || body.ids.some((x) => !Number.isSafeInteger(x))) throw new HttpError(400, "Invalid selection")
    rows = db.prepare(`SELECT token FROM links WHERE poll_id = ? AND group_id = ? AND enabled = 1 AND revoked_at IS NULL AND rowid IN (${body.ids.map(() => "?").join(",")})`).all(poll.id, groupId, ...(body.ids as number[])) as { token: string }[]
    if (rows.length !== new Set(body.ids).size) throw new HttpError(404, "Not found")
  } else {
    rows = db.prepare("SELECT token FROM links WHERE poll_id = ? AND group_id = ? AND enabled = 1 AND revoked_at IS NULL ORDER BY rowid LIMIT 10000").all(poll.id, groupId) as { token: string }[]
    if (rows.length === 10_000) throw new HttpError(413, "Select at most 10,000 URLs to copy at once")
  }
  const base = baseUrl(db)
  return json({ urls: rows.map((r) => `${base}/poll/${poll.id}?t=${r.token}`) })
})
