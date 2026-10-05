import type { DB } from "./db"
import { nowIso } from "./db"
import { audit } from "./audit"
import { ownedPoll } from "./authz"
import { cleanSlug, loadQuestions } from "./polls"
import { HttpError } from "./http"
import type { User } from "./auth"

export const ACTIONS = ["close", "reopen", "archive", "unarchive", "trash", "restore"] as const
export type Action = (typeof ACTIONS)[number]

export function applyAction(db: DB, user: User, pollId: string, action: Action) {
  const p = ownedPoll(db, user, pollId, { includeDeleted: action === "restore", need: action === "trash" || action === "restore" ? "owner" : "edit" })
  const now = nowIso()
  const set = (sql: string, ...a: (string | null)[]) => db.prepare(`UPDATE polls SET ${sql}, updated_at = ? WHERE id = ?`).run(...a, now, p.id)
  if (action === "close") set("status = 'closed'")
  else if (action === "reopen") {
    if (!db.prepare("SELECT 1 FROM questions WHERE poll_id = ?").get(p.id)) throw new HttpError(400, "Poll has no questions")
    set("status = 'open', closes_at = NULL")
  } else if (action === "archive") set("archived_at = ?", now)
  else if (action === "unarchive") set("archived_at = NULL")
  else if (action === "trash") set("deleted_at = ?", now)
  else if (action === "restore") {
    if (!p.deleted_at) throw new HttpError(400, "Poll is not in the trash")
    set("deleted_at = NULL")
  }
  audit(db, user.id, `poll_${action}`, { type: "poll", id: p.id })
}

export function duplicatePoll(db: DB, user: User, pollId: string, newId: string): string {
  const src = ownedPoll(db, user, pollId, { need: "view" })
  const id = cleanSlug(newId)
  if (db.prepare("SELECT 1 FROM polls WHERE id = ?").get(id)) throw new HttpError(409, "That poll id is taken")
  const now = nowIso()
  db.transaction(() => {
    db.prepare("INSERT INTO polls (id, title, description, owner_id, require_verification, created_at, updated_at) VALUES (?,?,?,?,?,?,?)").run(
      id, `${src.title} (copy)`.slice(0, 200), src.description, user.id, src.require_verification, now, now,
    )
    const iq = db.prepare("INSERT INTO questions (poll_id, prompt, type, required, position) VALUES (?,?,?,?,?)")
    const io = db.prepare("INSERT INTO options (question_id, label, position) VALUES (?,?,?)")
    loadQuestions(db, src.id).forEach((q, i) => {
      const qid = Number(iq.run(id, q.prompt, q.type, q.required ? 1 : 0, i).lastInsertRowid)
      q.options.forEach((o, j) => io.run(qid, o.label, j))
    })
    audit(db, user.id, "poll_duplicated", { type: "poll", id }, { from: src.id })
  })()
  return id
}
