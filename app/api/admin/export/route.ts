import { route } from "@/lib/server/authz"
import { download, HttpError } from "@/lib/server/http"
import { fullExport, flatCsv } from "@/lib/server/export"
import { audit } from "@/lib/server/audit"
import { SLUG } from "@/lib/server/polls"

// Admin-only. Contains link tokens (access credentials) and every tracked response field.
export const GET = route({ access: "admin" }, ({ db, user, url }) => {
  const poll = url.searchParams.get("poll")
  const format = url.searchParams.get("format") ?? "json"
  if (format !== "json" && format !== "csv") throw new HttpError(400, "Invalid format")
  if (poll !== null && (!SLUG.test(poll) || !db.prepare("SELECT 1 FROM polls WHERE id = ?").get(poll))) throw new HttpError(404, "Not found")
  const data = fullExport(db, poll ? [poll] : null)
  audit(db, user.id, "full_export", { type: poll ? "poll" : "all", id: poll ?? "all" }, { format, polls: data.polls.length })
  const name = poll ?? "all-polls"
  return format === "csv"
    ? download(flatCsv(data), `${name}-full-export.csv`, "text/csv")
    : download(JSON.stringify(data, null, 2), `${name}-full-export.json`, "application/json")
})
