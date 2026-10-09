import { route } from "@/lib/server/authz"
import { csvCell, download, HttpError } from "@/lib/server/http"
import { audit } from "@/lib/server/audit"

export const GET = route({ perm: "audit:export" }, ({ db, user, url }) => {
  const format = url.searchParams.get("format") ?? "csv"
  if (format !== "csv" && format !== "json") throw new HttpError(400, "Invalid format")
  const rows = db.prepare("SELECT id, at, actor_name AS actor, action, target_type AS targetType, target_id AS targetId, details, request_id AS requestId, ip, user_agent AS userAgent, result, previous_hash AS previousHash, entry_hash AS entryHash FROM audit_log ORDER BY id").all() as Record<string, string | number | null>[]
  audit(db, user.id, "audit_exported", { type: "audit_log", id: "all" }, { format, count: rows.length })
  if (format === "json") return download(JSON.stringify(rows, null, 2), "audit-log.json", "application/json")
  const columns = ["id", "at", "actor", "action", "targetType", "targetId", "details", "requestId", "ip", "userAgent", "result", "previousHash", "entryHash"]
  const lines = [columns.join(","), ...rows.map((r) => columns.map((c) => csvCell(r[c] ?? "")).join(","))]
  return download(lines.join("\r\n") + "\r\n", "audit-log.csv", "text/csv")
})
