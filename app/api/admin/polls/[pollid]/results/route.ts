import { route, ownedPoll } from "@/lib/server/authz"
import { json } from "@/lib/server/http"
import { pollResults } from "@/lib/server/results"

export const GET = route<{ pollid: string }>({ access: "user" }, ({ db, user, params }) => {
  const poll = ownedPoll(db, user, params.pollid, { includeDeleted: true })
  return json({ title: poll.title, requireVerification: !!poll.require_verification, ...pollResults(db, poll.id) })
})
