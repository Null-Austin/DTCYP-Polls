import { route, requireOn } from "@/lib/server/authz"
import { accessLevel, can, visiblePolls } from "@/lib/server/rbac"
import { exact, HttpError, json, readJson, str } from "@/lib/server/http"
import { cleanSlug } from "@/lib/server/polls"
import { audit } from "@/lib/server/audit"
import { nowIso } from "@/lib/server/db"

const SORTS: Record<string, string> = {
  title: "p.title COLLATE NOCASE",
  created: "p.created_at",
  last_response: "last_response",
  responses: "responses",
}

export const GET = route({ perm: ["polls:read", "polls:create"] }, ({ db, user, url }) => {
  requireOn(db, user, "polls:read")
  const sp = url.searchParams
  const where: string[] = []
  const args: (string | number)[] = []
  const visible = visiblePolls(db, user)
  where.push(visible.sql)
  args.push(...visible.args)
  if (user.isRoot && sp.get("owner")) {
    where.push("p.owner_id = ?")
    args.push(Number(sp.get("owner")) || 0)
  }
  const status = sp.get("status") ?? ""
  if (status === "trash") where.push("p.deleted_at IS NOT NULL")
  else {
    where.push("p.deleted_at IS NULL")
    if (status === "archived") where.push("p.archived_at IS NOT NULL")
    else {
      where.push("p.archived_at IS NULL")
      if (["draft", "open", "closed"].includes(status)) {
        where.push("p.status = ?")
        args.push(status)
      }
    }
  }
  const q = (sp.get("q") ?? "").slice(0, 100)
  if (q) {
    where.push("(p.title LIKE ? ESCAPE '\\' OR p.id LIKE ? ESCAPE '\\')")
    const like = `%${q.replace(/[\\%_]/g, "\\$&")}%`
    args.push(like, like)
  }
  const requestedSort = sp.get("sort") ?? ""
  const globalResponseRead = user.isRoot || user.grants.some((g) => g.permission === "responses:read" && g.scope === "")
  const order = !globalResponseRead && ["responses", "last_response"].includes(requestedSort) ? SORTS.created : SORTS[requestedSort] ?? SORTS.created
  const dir = sp.get("dir") === "asc" ? "ASC" : "DESC"
  const rows = db
    .prepare(
      `SELECT p.id, p.title, p.status, p.owner_id, u.username AS owner, p.created_at, p.archived_at, p.deleted_at,
        (SELECT COUNT(*) FROM responses r WHERE r.poll_id = p.id) AS responses,
        (SELECT MAX(submitted_at) FROM responses r WHERE r.poll_id = p.id) AS last_response
       FROM polls p JOIN users u ON u.id = p.owner_id
       WHERE ${where.join(" AND ")} ORDER BY ${order} ${dir} LIMIT 500`,
    )
    .all(...args) as { id: string; owner_id: number; [key: string]: unknown }[]
  return json({ polls: rows.map((p) => {
    const mayReadResponses = can(db, user, "responses:read", { pollId: p.id, ownerId: p.owner_id })
    return { ...p, access: accessLevel(db, user, p), responses: mayReadResponses ? p.responses : null, last_response: mayReadResponses ? p.last_response : null }
  }) })
})

export const POST = route({ perm: ["polls:read", "polls:create"] }, async ({ req, db, user }) => {
  requireOn(db, user, "polls:create")
  const body = await readJson(req, 4096)
  exact(body, ["id", "title", "description"])
  const id = cleanSlug(body.id)
  const title = str(body.title, 200, { min: 1 })
  const description = str(body.description, 2000, { optional: true })
  if (db.prepare("SELECT 1 FROM polls WHERE id = ?").get(id)) throw new HttpError(409, "That poll id is taken")
  const now = nowIso()
  db.transaction(() => {
    db.prepare("INSERT INTO polls (id, title, description, owner_id, created_at, updated_at) VALUES (?,?,?,?,?,?)").run(id, title, description, user.id, now, now)
    audit(db, user.id, "poll_created", { type: "poll", id })
  })()
  return json({ id }, 201)
})
