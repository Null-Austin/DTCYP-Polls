import { route, ownedPoll } from "@/lib/server/authz"
import { exact, HttpError, intIn, json, readJson } from "@/lib/server/http"
import { audit } from "@/lib/server/audit"
import { nowIso, type DB } from "@/lib/server/db"

type P = { pollid: string }

function list(db: DB, pollId: string) {
  return db
    .prepare(
      `SELECT s.user_id AS userId, u.username, s.permission, s.created_at AS createdAt
       FROM poll_shares s JOIN users u ON u.id = s.user_id WHERE s.poll_id = ? ORDER BY u.username COLLATE NOCASE`,
    )
    .all(pollId)
}

export const GET = route<P>({ access: "user" }, ({ db, user, params }) => {
  const poll = ownedPoll(db, user, params.pollid, { includeDeleted: true, need: "view" })
  const owner = db.prepare("SELECT username FROM users WHERE id = ?").get(poll.owner_id) as { username: string }
  return json({ access: poll.access, owner: owner.username, shares: list(db, poll.id) })
})

// Owner (or admin) grants or changes access by username.
export const POST = route<P>({ access: "user" }, async ({ req, db, user, params }) => {
  const poll = ownedPoll(db, user, params.pollid, { need: "owner" })
  const body = await readJson(req, 512)
  exact(body, ["username", "permission"])
  if (body.permission !== "view" && body.permission !== "edit") throw new HttpError(400, "Invalid permission")
  const target = typeof body.username === "string"
    ? (db.prepare("SELECT id FROM users WHERE username = ? AND disabled_at IS NULL").get(body.username.trim().slice(0, 32)) as { id: number } | undefined)
    : undefined
  if (!target) throw new HttpError(404, "No active user with that username")
  if (target.id === poll.owner_id) throw new HttpError(400, "That user already owns this poll")
  db.transaction(() => {
    db.prepare(
      "INSERT INTO poll_shares (poll_id, user_id, permission, created_at) VALUES (?,?,?,?) ON CONFLICT(poll_id, user_id) DO UPDATE SET permission = excluded.permission",
    ).run(poll.id, target.id, body.permission as string, nowIso())
    audit(db, user.id, "share_set", { type: "poll", id: poll.id }, { user: target.id, permission: body.permission as string })
  })()
  return json({ shares: list(db, poll.id) })
})

// Owner/admin can remove anyone; a shared user can remove themselves.
export const DELETE = route<P>({ access: "user" }, async ({ req, db, user, params }) => {
  const poll = ownedPoll(db, user, params.pollid, { need: "view" })
  const body = await readJson(req, 256)
  exact(body, ["userId"])
  const uid = intIn(body.userId, 1, 2 ** 31)
  if (uid !== user.id && poll.access !== "owner") throw new HttpError(403, "Forbidden")
  db.transaction(() => {
    const r = db.prepare("DELETE FROM poll_shares WHERE poll_id = ? AND user_id = ?").run(poll.id, uid)
    if (!r.changes) throw new HttpError(404, "Not found")
    audit(db, user.id, "share_removed", { type: "poll", id: poll.id }, { user: uid })
  })()
  return json({ shares: list(db, poll.id) })
})
