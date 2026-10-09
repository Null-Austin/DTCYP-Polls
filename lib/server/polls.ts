import type { DB } from "./db"
import { nowIso } from "./db"
import { exact, HttpError, intIn, str } from "./http"
import type { PollRow } from "./authz"

export const RESERVED = new Set(["users", "polls", "settings", "account", "audit", "links", "results", "new", "api", "admin", "bulk", "login", "poll", "test"])
export const SLUG = /^[a-z0-9][a-z0-9-]{1,59}$/

export function cleanSlug(v: unknown): string {
  const s = str(v, 60, { min: 2 })
  if (!SLUG.test(s) || RESERVED.has(s)) throw new HttpError(400, "Poll id must be 2-60 lowercase letters, numbers or hyphens")
  return s
}

export type QType = "single" | "multiple" | "text" | "rating"
export type QuestionIn = { id?: number; prompt: string; type: QType; required: boolean; options: { id?: number; label: string }[] }
export type QuestionOut = { id: number; prompt: string; type: QType; required: boolean; options: { id: number; label: string }[] }

export function loadQuestions(db: DB, pollId: string): QuestionOut[] {
  const qs = db.prepare("SELECT id, prompt, type, required FROM questions WHERE poll_id = ? ORDER BY position").all(pollId) as {
    id: number
    prompt: string
    type: QType
    required: number
  }[]
  const opts = db
    .prepare("SELECT o.id, o.question_id, o.label FROM options o JOIN questions q ON q.id = o.question_id WHERE q.poll_id = ? ORDER BY o.position")
    .all(pollId) as { id: number; question_id: number; label: string }[]
  return qs.map((q) => ({
    id: q.id,
    prompt: q.prompt,
    type: q.type,
    required: !!q.required,
    options: opts.filter((o) => o.question_id === q.id).map((o) => ({ id: o.id, label: o.label })),
  }))
}

export function parseQuestions(v: unknown): QuestionIn[] {
  if (!Array.isArray(v) || v.length > 50) throw new HttpError(400, "Invalid questions")
  return v.map((raw) => {
    if (!raw || typeof raw !== "object") throw new HttpError(400, "Invalid question")
    const q = raw as Record<string, unknown>
    exact(q, ["id", "prompt", "type", "required", "options"])
    if (!["single", "multiple", "text", "rating"].includes(q.type as string)) throw new HttpError(400, "Invalid question type")
    const type = q.type as QType
    const optsRaw = q.options === undefined ? [] : q.options
    if (!Array.isArray(optsRaw) || optsRaw.length > 30) throw new HttpError(400, "Invalid options")
    const options = optsRaw.map((o) => {
      if (!o || typeof o !== "object") throw new HttpError(400, "Invalid option")
      exact(o as Record<string, unknown>, ["id", "label"])
      const oo = o as { id?: unknown; label: unknown }
      return { id: oo.id === undefined ? undefined : intIn(oo.id, 1, 2 ** 31), label: str(oo.label, 200, { min: 1 }) }
    })
    if ((type === "single" || type === "multiple") && options.length < 2) throw new HttpError(400, "Choice questions need at least two options")
    if ((type === "text" || type === "rating") && options.length) throw new HttpError(400, "This question type has no options")
    if (typeof q.required !== "boolean") throw new HttpError(400, "Invalid question")
    return {
      id: q.id === undefined ? undefined : intIn(q.id, 1, 2 ** 31),
      prompt: str(q.prompt, 300, { min: 1 }),
      type,
      required: q.required,
      options,
    }
  })
}

export const responseCount = (db: DB, pollId: string) =>
  (db.prepare("SELECT COUNT(*) AS n FROM responses WHERE poll_id = ?").get(pollId) as { n: number }).n

export function saveQuestions(db: DB, pollId: string, qs: QuestionIn[]) {
  if (responseCount(db, pollId) > 0) {
    // Structure is locked once answers exist; only wording/order/required may change.
    const cur = loadQuestions(db, pollId)
    const locked = () => new HttpError(409, "This poll has responses. Duplicate it to change its structure.")
    if (qs.length !== cur.length) throw locked()
    for (const q of qs) {
      const c = cur.find((x) => x.id === q.id)
      if (!c || c.type !== q.type || c.options.length !== q.options.length) throw locked()
      for (const o of q.options) if (!c.options.some((x) => x.id === o.id)) throw locked()
    }
    if (new Set(qs.map((q) => q.id)).size !== qs.length) throw locked()
    const uq = db.prepare("UPDATE questions SET prompt = ?, required = ?, position = ? WHERE id = ? AND poll_id = ?")
    const uo = db.prepare("UPDATE options SET label = ?, position = ? WHERE id = ? AND question_id = ?")
    qs.forEach((q, i) => {
      uq.run(q.prompt, q.required ? 1 : 0, i, q.id, pollId)
      q.options.forEach((o, j) => uo.run(o.label, j, o.id, q.id))
    })
    return
  }
  db.prepare("DELETE FROM questions WHERE poll_id = ?").run(pollId)
  const iq = db.prepare("INSERT INTO questions (poll_id, prompt, type, required, position) VALUES (?,?,?,?,?)")
  const io = db.prepare("INSERT INTO options (question_id, label, position) VALUES (?,?,?)")
  qs.forEach((q, i) => {
    const id = Number(iq.run(pollId, q.prompt, q.type, q.required ? 1 : 0, i).lastInsertRowid)
    q.options.forEach((o, j) => io.run(id, o.label, j))
  })
}

export function pollDto(db: DB, p: PollRow & { access?: string }) {
  return {
    access: p.access ?? "owner",
    id: p.id,
    title: p.title,
    description: p.description,
    status: p.status,
    requireVerification: !!p.require_verification,
    opensAt: p.opens_at,
    closesAt: p.closes_at,
    archivedAt: p.archived_at,
    deletedAt: p.deleted_at,
    ownerId: p.owner_id,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
    hasResponses: responseCount(db, p.id) > 0,
    questions: loadQuestions(db, p.id),
  }
}

export function cleanDate(v: unknown): string | null {
  if (v === null || v === "") return null
  const s = str(v, 40)
  const t = Date.parse(s)
  if (Number.isNaN(t)) throw new HttpError(400, "Invalid date")
  return new Date(t).toISOString()
}

export function touch(db: DB, pollId: string) {
  db.prepare("UPDATE polls SET updated_at = ? WHERE id = ?").run(nowIso(), pollId)
}

// ---------- public side ----------

export const TOKEN = /^[A-Za-z0-9_-]{16,64}$/

export type PollState = "open" | "closed" | "not_open"

export function pollState(p: Pick<PollRow, "status" | "opens_at" | "closes_at" | "archived_at">, now = Date.now()): PollState {
  if (p.status === "draft") return "not_open"
  if (p.status === "closed" || p.archived_at) return "closed"
  if (p.opens_at && Date.parse(p.opens_at) > now) return "not_open"
  if (p.closes_at && Date.parse(p.closes_at) <= now) return "closed"
  return "open"
}

// Any failure looks identical to the caller: link and poll mismatch, revoked, trashed, unknown.
export function findLinkedPoll(db: DB, pollId: string, token: unknown): PollRow | null {
  if (typeof token !== "string" || !TOKEN.test(token) || !SLUG.test(pollId)) return null
  const p = db
    .prepare(
      `SELECT p.* FROM polls p JOIN links l ON l.poll_id = p.id
      WHERE p.id = ? AND l.token = ? AND l.revoked_at IS NULL AND l.enabled = 1 AND p.deleted_at IS NULL`,
    )
    .get(pollId, token) as PollRow | undefined
  return p ?? null
}

export const linkUsed = (db: DB, token: string) =>
  !!db.prepare("SELECT 1 FROM responses WHERE link_token = ? AND status IN ('verified','accepted') LIMIT 1").get(token)

export type AnswerIn = { questionId: number; optionIds?: number[]; text?: string; rating?: number }

export function parseAnswers(v: unknown): AnswerIn[] {
  if (!Array.isArray(v) || v.length > 60) throw new HttpError(400, "Invalid answers")
  return v.map((raw) => {
    if (!raw || typeof raw !== "object") throw new HttpError(400, "Invalid answer")
    const a = raw as Record<string, unknown>
    exact(a, ["questionId", "optionIds", "text", "rating"])
    const out: AnswerIn = { questionId: intIn(a.questionId, 1, 2 ** 31) }
    if (a.optionIds !== undefined) {
      if (!Array.isArray(a.optionIds) || a.optionIds.length > 30) throw new HttpError(400, "Invalid answer")
      out.optionIds = a.optionIds.map((x) => intIn(x, 1, 2 ** 31))
    }
    if (a.text !== undefined) out.text = str(a.text, 2000)
    if (a.rating !== undefined) out.rating = intIn(a.rating, 1, 5)
    return out
  })
}

type Row = { questionId: number; optionId: number | null; text: string | null }

export function validateAnswers(questions: QuestionOut[], answers: AnswerIn[]): Row[] {
  const byQ = new Map<number, AnswerIn>()
  for (const a of answers) {
    if (byQ.has(a.questionId) || !questions.some((q) => q.id === a.questionId)) throw new HttpError(400, "Invalid answers")
    byQ.set(a.questionId, a)
  }
  const rows: Row[] = []
  for (const q of questions) {
    const a = byQ.get(q.id)
    const missing = () => {
      if (q.required) throw new HttpError(400, "Please answer all required questions", { questionId: q.id })
    }
    if (!a) {
      missing()
      continue
    }
    if (q.type === "single" || q.type === "multiple") {
      const ids = [...new Set(a.optionIds ?? [])]
      if (a.text !== undefined || a.rating !== undefined) throw new HttpError(400, "Invalid answers")
      if (!ids.length) {
        missing()
        continue
      }
      if (q.type === "single" && ids.length !== 1) throw new HttpError(400, "Invalid answers")
      if (ids.some((id) => !q.options.some((o) => o.id === id))) throw new HttpError(400, "Invalid answers")
      for (const id of ids) rows.push({ questionId: q.id, optionId: id, text: null })
    } else if (q.type === "text") {
      if (a.optionIds || a.rating !== undefined) throw new HttpError(400, "Invalid answers")
      if (!a.text) {
        missing()
        continue
      }
      rows.push({ questionId: q.id, optionId: null, text: a.text })
    } else {
      if (a.optionIds || a.text !== undefined) throw new HttpError(400, "Invalid answers")
      if (a.rating === undefined) {
        missing()
        continue
      }
      rows.push({ questionId: q.id, optionId: null, text: String(a.rating) })
    }
  }
  return rows
}

export function deviceClass(ua: string | null): "mobile" | "desktop" {
  return /Mobi|Android|iPhone|iPad|iPod/i.test(ua ?? "") ? "mobile" : "desktop"
}

export function languageCode(al: string | null): string {
  const m = /^\s*([a-z]{2})/i.exec(al ?? "")
  return m ? m[1].toLowerCase() : "xx"
}

export const hourBucket = (d = new Date()) => {
  const x = new Date(d)
  x.setUTCMinutes(0, 0, 0)
  return x.toISOString()
}

// One write transaction: concurrent submissions can never produce two verified rows.
export function submitResponse(
  db: DB,
  pollId: string,
  token: string,
  answers: AnswerIn[],
  meta: { device: "mobile" | "desktop"; language: string },
): "saved" {
  db.transaction(() => {
    const poll = findLinkedPoll(db, pollId, token)
    if (!poll) throw new HttpError(404, "Not found")
    if (pollState(poll) !== "open") throw new HttpError(409, "This poll is not accepting answers", { state: pollState(poll) })
    const rows = validateAnswers(loadQuestions(db, pollId), answers)
    let status: "verified" | "unverified" | "accepted" = "accepted"
    if (poll.require_verification) status = linkUsed(db, token) ? "unverified" : "verified"
    const r = db
      .prepare("INSERT INTO responses (poll_id, link_token, status, submitted_at, device_class, language) VALUES (?,?,?,?,?,?)")
      .run(pollId, token, status, hourBucket(), meta.device, meta.language)
    const ins = db.prepare("INSERT INTO answers (response_id, question_id, option_id, text) VALUES (?,?,?,?)")
    for (const row of rows) ins.run(r.lastInsertRowid, row.questionId, row.optionId, row.text)
  }).immediate()
  return "saved"
}
