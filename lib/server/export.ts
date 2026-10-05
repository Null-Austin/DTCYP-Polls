import type { DB } from "./db"
import { nowIso } from "./db"
import { csvCell } from "./http"
import { loadQuestions } from "./polls"

type Row = Record<string, string | number | null>
type ResponseRow = {
  id: number
  poll_id: string
  link_token: string
  status: string
  submitted_at: string
  device_class: string
  language: string
}

// Everything stored about a poll and its responses. Never includes password hashes or session data.
export function fullExport(db: DB, pollIds: string[] | null) {
  const polls = (
    pollIds
      ? pollIds.map((id) => db.prepare("SELECT * FROM polls WHERE id = ?").get(id) as Row | undefined).filter((p): p is Row => !!p)
      : (db.prepare("SELECT * FROM polls ORDER BY created_at").all() as Row[])
  ).map((p) => {
    const id = p.id as string
    const questions = loadQuestions(db, id)
    const label = (qid: number | null, oid: number | null) => ({
      question: questions.find((q) => q.id === qid)?.prompt ?? null,
      option: questions.flatMap((q) => q.options).find((o) => o.id === oid)?.label ?? null,
    })
    const answersByResponse = new Map<number, Row[]>()
    for (const a of db
      .prepare("SELECT a.response_id, a.question_id, a.option_id, a.text FROM answers a JOIN responses r ON r.id = a.response_id WHERE r.poll_id = ? ORDER BY a.id")
      .all(id) as { response_id: number; question_id: number; option_id: number | null; text: string | null }[]) {
      const l = label(a.question_id, a.option_id)
      const list = answersByResponse.get(a.response_id) ?? []
      list.push({ question_id: a.question_id, question: l.question, option_id: a.option_id, option: l.option, text: a.text })
      answersByResponse.set(a.response_id, list)
    }
    const responses = (db.prepare("SELECT * FROM responses WHERE poll_id = ? ORDER BY id").all(id) as ResponseRow[]).map((r) => ({
      ...r,
      answers: answersByResponse.get(r.id) ?? [],
    }))
    return {
      poll: p,
      owner: db.prepare("SELECT id, username, email, role FROM users WHERE id = ?").get(p.owner_id) ?? null,
      questions,
      shares: db
        .prepare("SELECT u.username, s.permission, s.created_at FROM poll_shares s JOIN users u ON u.id = s.user_id WHERE s.poll_id = ?")
        .all(id),
      batches: db.prepare("SELECT * FROM link_batches WHERE poll_id = ? ORDER BY id").all(id),
      links: db.prepare("SELECT token, batch_id, created_at, revoked_at FROM links WHERE poll_id = ? ORDER BY rowid").all(id),
      responses,
    }
  })
  const users = db
    .prepare("SELECT id, username, email, role, must_change_password, disabled_at, created_at, last_login_at FROM users ORDER BY id")
    .all()
  return { exportedAt: nowIso(), scope: pollIds ? "poll" : "all", polls, users }
}

// One row per answer (or per response with no answers), with all tracked response fields.
export function flatCsv(data: ReturnType<typeof fullExport>): string {
  const head = ["poll_id", "response_id", "link_token", "batch_id", "batch_label", "status", "submitted_at", "device_class", "language", "question", "option", "text"]
  const lines = [head.join(",")]
  for (const p of data.polls) {
    const batchOf = new Map((p.links as { token: string; batch_id: number }[]).map((l) => [l.token, l.batch_id]))
    const labelOf = new Map((p.batches as { id: number; label: string }[]).map((b) => [b.id, b.label]))
    for (const r of p.responses) {
      const batch = batchOf.get(r.link_token as string) ?? null
      const base = [p.poll.id, r.id, r.link_token, batch, batch === null ? "" : labelOf.get(batch) ?? "", r.status, r.submitted_at, r.device_class, r.language]
      const rows = r.answers.length ? r.answers : [{ question: "", option: "", text: "" }]
      for (const a of rows) lines.push([...base, a.question ?? "", a.option ?? "", a.text ?? ""].map((v) => csvCell(v ?? "")).join(","))
    }
  }
  return lines.join("\r\n") + "\r\n"
}
