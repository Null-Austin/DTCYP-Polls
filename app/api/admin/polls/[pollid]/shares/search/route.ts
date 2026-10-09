import { route, ownedPoll, requireOn } from "@/lib/server/authz"
import { json } from "@/lib/server/http"
import { type DB } from "@/lib/server/db"
import type { Actor } from "@/lib/server/rbac"

type P = { pollid: string }
function suggestions(db: DB, actor: Actor, query: string) {
  const escaped = query.replace(/[\\%_]/g, "\\$&")
  const rows = db.prepare(
    `SELECT u.id, u.username, u.kind, COALESCE((SELECT MAX(r.level) FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id),0) AS level
     FROM users u WHERE u.disabled_at IS NULL AND u.id != ? AND u.username LIKE ? ESCAPE '\\'
     ORDER BY u.username COLLATE NOCASE LIMIT 100`,
  ).all(actor.id, `%${escaped}%`) as { id: number; username: string; kind: string; level: number }[]
  return rows.slice(0, 20).map((r) => ({
    id: r.id,
    label: r.kind === "bot" ? r.username : r.username,
    kind: r.kind,
    level: r.level,
    roles: db.prepare("SELECT r.name, r.color FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ? ORDER BY r.position").all(r.id),
  }))
}

export const GET = route<P>({ perm: "polls:share" }, ({ db, user, params, url }) => {
  const poll = ownedPoll(db, user, params.pollid)
  requireOn(db, user, "polls:share", { pollId: poll.id, ownerId: poll.owner_id })
  const query = (url.searchParams.get("q") ?? "").trim().slice(0, 40)
  if (!query) return json({ accounts: [] })
  return json({ accounts: suggestions(db, user, query) })
})
