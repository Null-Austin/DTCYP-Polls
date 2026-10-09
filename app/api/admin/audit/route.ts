import { route } from "@/lib/server/authz"
import { json } from "@/lib/server/http"

export const GET = route({ perm: "audit:read" }, ({ db, url }) => {
  const before = Number(url.searchParams.get("before")) || Number.MAX_SAFE_INTEGER
  const where = ["a.id < ?"]
  const args: (number | string)[] = [before]
  const filters: [string, string, string][] = [
    ["actor", "a.actor_name", "contains"],
    ["action", "a.action", "contains"],
    ["target", "a.target_id", "contains"],
    ["result", "a.result", "exact"],
    ["from", "a.at", "lower"],
    ["to", "a.at", "upper"],
    ["q", "COALESCE(a.details, '') || ' ' || a.action || ' ' || COALESCE(a.target_id, '') || ' ' || COALESCE(a.actor_name, '')", "contains"],
  ]
  for (const [key, col, mode] of filters) {
    const v = url.searchParams.get(key)?.slice(0, 160)
    if (!v) continue
    if (mode === "exact") {
      where.push(`${col} = ?`)
      args.push(v)
    } else if (mode === "lower") {
      where.push(`${col} >= ?`)
      args.push(v)
    } else if (mode === "upper") {
      where.push(`${col} <= ?`)
      args.push(v)
    } else {
      where.push(`${col} LIKE ? ESCAPE '\\'`)
      args.push(`%${v.replace(/[\\%_]/g, "\\$&")}%`)
    }
  }
  const rows = db
    .prepare(
      `SELECT a.id, a.at, a.action, a.target_type AS targetType, a.target_id AS targetId, a.details, a.result, a.request_id AS requestId, a.actor_name AS actor, a.ip, a.user_agent AS userAgent, a.previous_hash AS previousHash, a.entry_hash AS entryHash
       FROM audit_log a LEFT JOIN users u ON u.id = a.actor_user_id
       WHERE ${where.join(" AND ")} ORDER BY a.id DESC LIMIT 100`,
    )
    .all(...args)
  return json({ entries: rows })
})
