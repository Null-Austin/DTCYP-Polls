import { route, ownedPoll } from "@/lib/server/authz"
import { json } from "@/lib/server/http"
import { can } from "@/lib/server/rbac"
import { audit } from "@/lib/server/audit"

export const GET = route<{ pollid: string }>({ perm: "polls:read" }, ({ db, user, params, url }) => {
  const poll = ownedPoll(db, user, params.pollid)
  const readable = can(db, user, "responses:read", { pollId: poll.id, ownerId: poll.owner_id })
  if (!readable) {
    audit(db, user.id, "api_responses_read_suppressed", { type: "poll", id: poll.id })
    return json({ responses: [], page: 0, pageSize: 100, total: 0 })
  }
  const page = Math.max(0, Math.min(1_000_000, Number(url.searchParams.get("page")) || 0))
  const total = (db.prepare("SELECT COUNT(*) AS n FROM responses WHERE poll_id = ?").get(poll.id) as { n: number }).n
  const rows = db.prepare(
    `SELECT id, status, submitted_at AS submittedAt, device_class AS deviceClass, language
     FROM responses WHERE poll_id = ? ORDER BY id LIMIT 100 OFFSET ?`,
  ).all(poll.id, page * 100) as { id: number; status: string; submittedAt: string; deviceClass: string; language: string }[]
  const responses = rows.map((r) => ({
    ...r,
    answers: db.prepare(
      `SELECT a.question_id AS questionId, q.prompt AS question, a.option_id AS optionId, o.label AS option, a.text
       FROM answers a JOIN questions q ON q.id = a.question_id LEFT JOIN options o ON o.id = a.option_id
       WHERE a.response_id = ? ORDER BY a.id`,
    ).all(r.id),
  }))
  audit(db, user.id, "api_responses_read", { type: "poll", id: poll.id }, { count: responses.length, page })
  return json({ responses, page, pageSize: 100, total })
})
