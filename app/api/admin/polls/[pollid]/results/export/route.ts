import { route, ownedPoll } from "@/lib/server/authz"
import { csvCell, download } from "@/lib/server/http"
import { pollResults } from "@/lib/server/results"
import { audit } from "@/lib/server/audit"

export const GET = route<{ pollid: string }>({ access: "user" }, ({ db, user, params }) => {
  const poll = ownedPoll(db, user, params.pollid, { includeDeleted: true })
  const res = pollResults(db, poll.id)
  const lines = ["question,type,answer,verified,unverified"]
  for (const q of res.questions) {
    if (q.type === "text") for (const t of q.texts) lines.push([q.prompt, q.type, t.text, t.status === "verified" ? 1 : 0, t.status === "unverified" ? 1 : 0].map(csvCell).join(","))
    else for (const o of q.options) lines.push([q.prompt, q.type, o.label, o.verified, o.unverified].map(csvCell).join(","))
  }
  audit(db, user.id, "results_exported", { type: "poll", id: poll.id })
  return download(lines.join("\r\n") + "\r\n", `${poll.id}-results.csv`, "text/csv")
})
