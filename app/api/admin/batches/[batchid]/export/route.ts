import { route, ownedBatch } from "@/lib/server/authz"
import { csvCell, download, HttpError } from "@/lib/server/http"
import { baseUrl } from "@/lib/server/links"
import { audit } from "@/lib/server/audit"

export const GET = route<{ batchid: string }>({ access: "user" }, ({ db, user, params, url }) => {
  const { batch, poll } = ownedBatch(db, user, params.batchid)
  const format = url.searchParams.get("format") ?? "csv"
  if (format !== "csv" && format !== "txt") throw new HttpError(400, "Invalid format")
  const base = baseUrl(db)
  const tokens = (db.prepare("SELECT token FROM links WHERE batch_id = ? AND revoked_at IS NULL ORDER BY rowid").all(batch.id) as { token: string }[]).map((r) => r.token)
  const link = (t: string) => `${base}/poll/${poll.id}?t=${t}`
  audit(db, user.id, "links_exported", { type: "poll", id: poll.id }, { batch: batch.id, format })
  if (format === "txt") return download(tokens.map(link).join("\n") + "\n", `${poll.id}-batch-${batch.id}.txt`, "text/plain")
  const rows = ["token,url,batch_label", ...tokens.map((t) => [t, link(t), batch.label].map(csvCell).join(","))]
  return download(rows.join("\r\n") + "\r\n", `${poll.id}-batch-${batch.id}.csv`, "text/csv")
})
