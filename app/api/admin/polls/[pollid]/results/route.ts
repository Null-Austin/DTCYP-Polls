import { route, ownedPoll } from "@/lib/server/authz"
import { json } from "@/lib/server/http"
import { pollResults } from "@/lib/server/results"
import { audit } from "@/lib/server/audit"

export const GET = route<{ pollid: string }>({ perm: "responses:read" }, ({ db, user, params }) => {
  const poll = ownedPoll(db, user, params.pollid, { includeDeleted: true, need: "polls:read" })
  audit(db, user.id, "results_viewed", { type: "poll", id: poll.id })
  return json({ title: poll.title, access: poll.access, requireVerification: !!poll.require_verification, ...pollResults(db, poll.id) })
})
