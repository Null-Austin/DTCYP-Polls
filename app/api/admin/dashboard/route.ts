import { route } from "@/lib/server/authz"
import { json } from "@/lib/server/http"

export const GET = route({ access: "user" }, ({ db, user }) => {
  const admin = user.role === "admin"
  const scope = admin ? "1=1" : "p.owner_id = ?"
  const a = admin ? [] : [user.id]
  const n = (sql: string) => (db.prepare(sql).get(...a) as { n: number }).n
  const base = "p.deleted_at IS NULL"
  return json({
    counts: {
      openPolls: n(`SELECT COUNT(*) AS n FROM polls p WHERE ${base} AND p.status = 'open' AND ${scope}`),
      links: n(`SELECT COUNT(*) AS n FROM links l JOIN polls p ON p.id = l.poll_id WHERE ${base} AND ${scope}`),
      verified: n(`SELECT COUNT(*) AS n FROM responses r JOIN polls p ON p.id = r.poll_id WHERE ${base} AND r.status IN ('verified','accepted') AND ${scope}`),
      repeats: n(`SELECT COUNT(*) AS n FROM responses r JOIN polls p ON p.id = r.poll_id WHERE ${base} AND r.status = 'unverified' AND ${scope}`),
    },
    recent: db
      .prepare(
        `SELECT p.id, p.title, p.status, MAX(r.submitted_at) AS lastResponse, COUNT(r.id) AS responses
         FROM polls p LEFT JOIN responses r ON r.poll_id = p.id WHERE ${base} AND ${scope}
         GROUP BY p.id ORDER BY COALESCE(MAX(r.submitted_at), p.updated_at) DESC LIMIT 5`,
      )
      .all(...a),
    activity: db
      .prepare(
        `SELECT id, at, action, target_type AS targetType, target_id AS targetId FROM audit_log
         ${admin ? "" : "WHERE actor_user_id = ?"} ORDER BY id DESC LIMIT 10`,
      )
      .all(...(admin ? [] : [user.id])),
  })
})
