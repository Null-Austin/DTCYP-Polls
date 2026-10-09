import { route } from "@/lib/server/authz"
import { json } from "@/lib/server/http"
import { can, visiblePolls } from "@/lib/server/rbac"

export const GET = route({ perm: "polls:read" }, ({ db, user }) => {
  const visibility = visiblePolls(db, user)
  const scope = visibility.sql
  const a = visibility.args
  const linkVisibility = visiblePolls(db, user, "urls:read")
  const responseVisibility = visiblePolls(db, user, "responses:read")
  const auditVisible = user.isRoot || user.grants.some((g) => g.permission === "audit:read" && g.scope === "")
  const n = (sql: string, args: (string | number)[] = a) => (db.prepare(sql).get(...args) as { n: number }).n
  const base = "p.deleted_at IS NULL"
  return json({
    counts: {
      openPolls: n(`SELECT COUNT(*) AS n FROM polls p WHERE ${base} AND p.status = 'open' AND ${scope}`),
      links: n(`SELECT COUNT(*) AS n FROM links l JOIN polls p ON p.id = l.poll_id WHERE ${base} AND ${linkVisibility.sql}`, linkVisibility.args),
      verified: n(`SELECT COUNT(*) AS n FROM responses r JOIN polls p ON p.id = r.poll_id WHERE ${base} AND r.status IN ('verified','accepted') AND ${responseVisibility.sql}`, responseVisibility.args),
      repeats: n(`SELECT COUNT(*) AS n FROM responses r JOIN polls p ON p.id = r.poll_id WHERE ${base} AND r.status = 'unverified' AND ${responseVisibility.sql}`, responseVisibility.args),
    },
    recent: db
      .prepare(
        `SELECT p.id, p.title, p.status, MAX(r.submitted_at) AS lastResponse, COUNT(r.id) AS responses
         FROM polls p LEFT JOIN responses r ON r.poll_id = p.id WHERE ${base} AND ${scope}
         GROUP BY p.id ORDER BY p.updated_at DESC LIMIT 5`,
      )
      .all(...a).map((row) => {
        const r = row as { id: string; owner_id?: number; responses: number; lastResponse: string | null }
        const poll = db.prepare("SELECT owner_id FROM polls WHERE id = ?").get(r.id) as { owner_id: number }
        const allowed = can(db, user, "responses:read", { pollId: r.id, ownerId: poll.owner_id })
        return allowed ? r : { ...r, responses: null, lastResponse: null }
      }),
    activity: db
      .prepare(
        `SELECT id, at, action, target_type AS targetType, target_id AS targetId FROM audit_log
         ${auditVisible ? "" : "WHERE actor_user_id = ?"} ORDER BY id DESC LIMIT 10`,
      )
      .all(...(auditVisible ? [] : [user.id])),
  })
})
