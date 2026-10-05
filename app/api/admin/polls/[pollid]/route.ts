import { route, ownedPoll } from "@/lib/server/authz"
import { exact, HttpError, json, readJson, str } from "@/lib/server/http"
import { cleanDate, pollDto, saveQuestions, parseQuestions, touch } from "@/lib/server/polls"
import { audit } from "@/lib/server/audit"

type P = { pollid: string }

export const GET = route<P>({ access: "user" }, ({ db, user, params }) => {
  return json(pollDto(db, ownedPoll(db, user, params.pollid, { includeDeleted: true })))
})

export const PATCH = route<P>({ access: "user" }, async ({ req, db, user, params }) => {
  const body = await readJson(req)
  exact(body, ["title", "description", "status", "requireVerification", "opensAt", "closesAt", "questions"])
  ownedPoll(db, user, params.pollid)
  db.transaction(() => {
    const p = ownedPoll(db, user, params.pollid)
    const title = body.title !== undefined ? str(body.title, 200, { min: 1 }) : p.title
    const description = body.description !== undefined ? str(body.description, 2000, { optional: true }) : p.description
    let status = p.status
    if (body.status !== undefined) {
      if (!["draft", "open", "closed"].includes(body.status as string)) throw new HttpError(400, "Invalid status")
      status = body.status as typeof status
    }
    if (body.requireVerification !== undefined && typeof body.requireVerification !== "boolean") throw new HttpError(400, "Invalid input")
    const rv = body.requireVerification === undefined ? p.require_verification : body.requireVerification ? 1 : 0
    const opens = body.opensAt !== undefined ? cleanDate(body.opensAt) : p.opens_at
    const closes = body.closesAt !== undefined ? cleanDate(body.closesAt) : p.closes_at
    if (opens && closes && Date.parse(opens) >= Date.parse(closes)) throw new HttpError(400, "Closing time must be after opening time")
    if (body.questions !== undefined) saveQuestions(db, p.id, parseQuestions(body.questions))
    if (status === "open" && !db.prepare("SELECT 1 FROM questions WHERE poll_id = ?").get(p.id)) {
      throw new HttpError(400, "Add at least one question before opening the poll")
    }
    db.prepare("UPDATE polls SET title=?, description=?, status=?, require_verification=?, opens_at=?, closes_at=? WHERE id=?").run(
      title, description, status, rv, opens, closes, p.id,
    )
    touch(db, p.id)
    audit(db, user.id, "poll_updated", { type: "poll", id: p.id }, { status, structure: body.questions !== undefined })
  }).immediate()
  return json(pollDto(db, ownedPoll(db, user, params.pollid)))
})

// Permanent delete: caller must type the slug.
export const DELETE = route<P>({ access: "user" }, async ({ req, db, user, params }) => {
  const body = await readJson(req, 1024)
  exact(body, ["confirm"])
  const p = ownedPoll(db, user, params.pollid, { includeDeleted: true })
  if (body.confirm !== p.id) throw new HttpError(400, "Type the poll id to confirm")
  db.transaction(() => {
    db.prepare("DELETE FROM polls WHERE id = ?").run(p.id)
    audit(db, user.id, "poll_deleted_permanently", { type: "poll", id: p.id })
  })()
  return json({ ok: true })
})
