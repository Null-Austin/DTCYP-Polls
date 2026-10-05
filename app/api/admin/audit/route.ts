import { route } from "@/lib/server/authz"
import { json } from "@/lib/server/http"

export const GET = route({ access: "admin" }, ({ db, url }) => {
  const before = Number(url.searchParams.get("before")) || Number.MAX_SAFE_INTEGER
  const prefix = (url.searchParams.get("action") ?? "").slice(0, 40).replace(/[\\%_]/g, "\\$&")
  const rows = db
    .prepare(
      `SELECT a.id, a.at, a.action, a.target_type AS targetType, a.target_id AS targetId, a.details, u.username AS actor
       FROM audit_log a LEFT JOIN users u ON u.id = a.actor_user_id
       WHERE a.id < ? AND a.action LIKE ? ESCAPE '\\' ORDER BY a.id DESC LIMIT 100`,
    )
    .all(before, `${prefix}%`)
  return json({ entries: rows })
})
