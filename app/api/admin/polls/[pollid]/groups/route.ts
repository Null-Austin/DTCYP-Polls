import { randomBytes } from "node:crypto"
import { route, ownedPoll, requireOn } from "@/lib/server/authz"
import { exact, HttpError, intIn, json, readJson, str } from "@/lib/server/http"
import { audit } from "@/lib/server/audit"
import { nowIso } from "@/lib/server/db"
import { batchList } from "@/lib/server/links"

type P = { pollid: string }

function list(db: Parameters<typeof audit>[0], pollId: string) {
  return db.prepare(
    `SELECT g.id, g.name, g.position, g.archived_at AS archivedAt, g.created_at AS createdAt,
      COUNT(l.rowid) AS urlCount,
      SUM(CASE WHEN l.enabled = 1 AND l.revoked_at IS NULL THEN 1 ELSE 0 END) AS activeCount,
      (SELECT COUNT(DISTINCT r.link_token) FROM responses r JOIN links li ON li.token = r.link_token WHERE li.group_id = g.id AND r.status IN ('verified','accepted')) AS answeredCount,
      (SELECT COUNT(*) FROM responses r JOIN links li ON li.token = r.link_token WHERE li.group_id = g.id AND r.status = 'unverified') AS repeatCount
     FROM distribution_groups g LEFT JOIN links l ON l.group_id = g.id
     WHERE g.poll_id = ? GROUP BY g.id ORDER BY g.position, g.id`,
  ).all(pollId)
}

function visibleGroups(db: Parameters<typeof audit>[0], actor: Parameters<typeof requireOn>[1], pollId: string, ownerId: number) {
  return (list(db, pollId) as { id: number }[]).filter((g) => {
    try { requireOn(db, actor, "groups:read", { pollId, ownerId, groupId: g.id }); return true } catch { return false }
  })
}

function group(db: Parameters<typeof audit>[0], pollId: string, raw: unknown) {
  const id = intIn(raw, 1, 2 ** 31)
  const g = db.prepare("SELECT * FROM distribution_groups WHERE id = ? AND poll_id = ?").get(id, pollId) as { id: number; name: string; position: number; archived_at: string | null } | undefined
  if (!g) throw new HttpError(404, "Not found")
  return g
}

export const GET = route<P>({ perm: ["groups:read", "groups:create", "groups:edit", "groups:delete"] }, ({ db, user, params }) => {
  const poll = ownedPoll(db, user, params.pollid)
  const groups = visibleGroups(db, user, poll.id, poll.owner_id)
  const groupsWithCounts = groups.map((g) => {
    const mayRead = (() => { try { requireOn(db, user, "responses:read", { pollId: poll.id, ownerId: poll.owner_id, groupId: g.id }); return true } catch { return false } })()
    if (mayRead) return g
    return { ...g, answeredCount: null, repeatCount: null }
  })
  return json({ groups: groupsWithCounts, batches: batchList(db, poll.id) })
})

export const POST = route<P>({ perm: ["groups:create", "groups:edit"] }, async ({ req, db, user, params }) => {
  const poll = ownedPoll(db, user, params.pollid)
  requireOn(db, user, "groups:create", { pollId: poll.id, ownerId: poll.owner_id })
  const body = await readJson(req, 2048)
  exact(body, ["name", "duplicateFrom"])
  const name = str(body.name, 100, { optional: true })
  const now = nowIso()
  const created = db.transaction(() => {
    const pos = (db.prepare("SELECT COALESCE(MAX(position), -1) AS n FROM distribution_groups WHERE poll_id = ?").get(poll.id) as { n: number }).n + 1
    if (body.duplicateFrom === undefined) {
      const id = Number(db.prepare("INSERT INTO distribution_groups (poll_id, name, position, created_at) VALUES (?,?,?,?)").run(poll.id, name, pos, now).lastInsertRowid)
      audit(db, user.id, "group_created", { type: "group", id }, { poll: poll.id, name })
      return { id, links: 0 }
    }
    requireOn(db, user, "urls:create", { pollId: poll.id, ownerId: poll.owner_id })
    const source = group(db, poll.id, body.duplicateFrom)
    const originals = db.prepare("SELECT * FROM links WHERE group_id = ? AND enabled = 1 AND revoked_at IS NULL ORDER BY rowid LIMIT 10000").all(source.id) as { display_title: string; notes: string }[]
    const batchId = Number(db.prepare("INSERT INTO link_batches (poll_id, label, count, created_at) VALUES (?,?,?,?)").run(poll.id, `${name || source.name} copy`, originals.length, now).lastInsertRowid)
    const newGroup = Number(db.prepare("INSERT INTO distribution_groups (poll_id, name, position, created_at) VALUES (?,?,?,?)").run(poll.id, name || `${source.name} copy`.slice(0, 100), pos, now).lastInsertRowid)
    const ins = db.prepare("INSERT INTO links (token, poll_id, batch_id, created_at, group_id, display_title, notes) VALUES (?,?,?,?,?,?,?)")
    for (const item of originals) ins.run(randomBytes(18).toString("base64url"), poll.id, batchId, now, newGroup, item.display_title, item.notes)
    audit(db, user.id, "group_duplicated", { type: "group", id: newGroup }, { from: source.id, links: originals.length })
    return { id: newGroup, links: originals.length }
  }).immediate()
  return json({ ...created, groups: list(db, poll.id) }, 201)
})

export const PATCH = route<P>({ perm: ["groups:edit", "groups:delete"] }, async ({ req, db, user, params }) => {
  const poll = ownedPoll(db, user, params.pollid)
  const body = await readJson(req, 1024)
  exact(body, ["id", "name", "position", "archived", "mergeInto"])
  const g = group(db, poll.id, body.id)
  requireOn(db, user, "groups:edit", { pollId: poll.id, ownerId: poll.owner_id, groupId: g.id })
  if (body.mergeInto !== undefined) {
    const dest = group(db, poll.id, body.mergeInto)
    requireOn(db, user, "groups:edit", { pollId: poll.id, ownerId: poll.owner_id, groupId: dest.id })
    if (dest.id === g.id) throw new HttpError(400, "Choose a different group")
    db.transaction(() => {
      const n = db.prepare("UPDATE links SET group_id = ? WHERE group_id = ?").run(dest.id, g.id).changes
      db.prepare("DELETE FROM distribution_groups WHERE id = ?").run(g.id)
      audit(db, user.id, "groups_merged", { type: "group", id: dest.id }, { removed: g.id, urls: n })
    })()
    return json({ groups: list(db, poll.id) })
  }
  if (body.archived !== undefined) {
    requireOn(db, user, "groups:edit", { pollId: poll.id, ownerId: poll.owner_id, groupId: g.id })
    if (typeof body.archived !== "boolean") throw new HttpError(400, "Invalid archive state")
  }
  if (body.name !== undefined || body.position !== undefined) requireOn(db, user, "groups:edit", { pollId: poll.id, ownerId: poll.owner_id, groupId: g.id })
  const name = body.name === undefined ? g.name : str(body.name, 100, { optional: true })
  const pos = body.position === undefined ? g.position : intIn(body.position, 0, 100_000)
  db.transaction(() => {
    db.prepare("UPDATE distribution_groups SET name = ?, position = ?, archived_at = ? WHERE id = ?").run(name, pos, body.archived === undefined ? g.archived_at : body.archived ? nowIso() : null, g.id)
    audit(db, user.id, "group_updated", { type: "group", id: g.id }, { name, position: pos, archived: typeof body.archived === "boolean" ? body.archived : !!g.archived_at })
  })()
  return json({ groups: list(db, poll.id) })
})

export const DELETE = route<P>({ perm: "groups:delete" }, async ({ req, db, user, params }) => {
  const poll = ownedPoll(db, user, params.pollid)
  requireOn(db, user, "groups:delete", { pollId: poll.id, ownerId: poll.owner_id })
  const body = await readJson(req, 512)
  exact(body, ["id"])
  const g = group(db, poll.id, body.id)
  requireOn(db, user, "groups:delete", { pollId: poll.id, ownerId: poll.owner_id, groupId: g.id })
  const n = (db.prepare("SELECT COUNT(*) AS n FROM links WHERE group_id = ?").get(g.id) as { n: number }).n
  if (n) throw new HttpError(409, "Move or delete the URLs in this group first")
  db.transaction(() => {
    db.prepare("DELETE FROM distribution_groups WHERE id = ?").run(g.id)
    audit(db, user.id, "group_deleted", { type: "group", id: g.id }, { poll: poll.id })
  })()
  return json({ groups: list(db, poll.id) })
})
