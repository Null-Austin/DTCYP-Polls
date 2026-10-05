import { route } from "@/lib/server/authz"
import { json, notFound } from "@/lib/server/http"
import { findLinkedPoll, loadQuestions, pollState } from "@/lib/server/polls"

export const GET = route<{ pollid: string }>({ access: "public" }, ({ db, params, url }) => {
  const token = url.searchParams.get("t")
  const poll = findLinkedPoll(db, params.pollid, token)
  if (!poll) throw notFound()
  const state = pollState(poll)
  const base = { title: poll.title, state, description: "", questions: [] as unknown[] }
  if (state !== "open") return json(base)
  return json({
    ...base,
    description: poll.description,
    questions: loadQuestions(db, poll.id),
  })
})
