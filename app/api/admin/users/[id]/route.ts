import { route } from "@/lib/server/authz"
import { exact, HttpError, json, readJson } from "@/lib/server/http"
import { destroyUserSessions } from "@/lib/server/auth"
import { audit } from "@/lib/server/audit"
import { nowIso, type DB } from "@/lib/server/db"

type P = { id: string }
type Target = { id: number; role: string; disabled_at: string | null }

function target(db: DB, raw: string): Target {
  const id = Number(raw)
  const t = Number.isInteger(id) ? (db.prepare("SELECT id, role, disabled_at FROM users WHERE id = ?").get(id) as Target | undefined) : undefined
  if (!t) throw new HttpError(404, "Not found")
  return t
}

// Must run inside a write transaction. Blocks any change that would leave zero active admins.
function assertAnotherAdmin(db: DB, t: Target) {
  if (t.role !== "admin" || t.disabled_at) return
  const n = (db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND disabled_at IS NULL AND id != ?").get(t.id) as { n: number }).n
  if (n < 1) throw new HttpError(409, "The last active admin cannot be removed, disabled or demoted")
}

export const PATCH = route<P>({ access: "admin" }, async ({ req, db, user, params }) => {
  const body = await readJson(req, 512)
  exact(body, ["role", "disabled"])
  db.transaction(() => {
    const t = target(db, params.id)
    if (body.role !== undefined) {
      if (body.role !== "admin" && body.role !== "editor") throw new HttpError(400, "Invalid role")
      if (body.role !== t.role) {
        if (body.role === "editor") assertAnotherAdmin(db, t)
        db.prepare("UPDATE users SET role = ? WHERE id = ?").run(body.role, t.id)
        destroyUserSessions(db, t.id)
        audit(db, user.id, "user_role_changed", { type: "user", id: t.id }, { role: body.role })
      }
    }
    if (body.disabled !== undefined) {
      if (typeof body.disabled !== "boolean") throw new HttpError(400, "Invalid input")
      if (body.disabled) {
        assertAnotherAdmin(db, t)
        db.prepare("UPDATE users SET disabled_at = ? WHERE id = ?").run(nowIso(), t.id)
        destroyUserSessions(db, t.id)
      } else db.prepare("UPDATE users SET disabled_at = NULL WHERE id = ?").run(t.id)
      audit(db, user.id, body.disabled ? "user_disabled" : "user_enabled", { type: "user", id: t.id })
    }
  }).immediate()
  return json({ ok: true })
})

export const DELETE = route<P>({ access: "admin" }, ({ db, user, params }) => {
  db.transaction(() => {
    const t = target(db, params.id)
    assertAnotherAdmin(db, t)
    // Polls are handed to the acting admin rather than deleted with the account.
    const heir = t.id === user.id ? (db.prepare("SELECT id FROM users WHERE role = 'admin' AND disabled_at IS NULL AND id != ? LIMIT 1").get(t.id) as { id: number }).id : user.id
    db.prepare("UPDATE polls SET owner_id = ? WHERE owner_id = ?").run(heir, t.id)
    db.prepare("DELETE FROM users WHERE id = ?").run(t.id)
    audit(db, user.id, "user_deleted", { type: "user", id: t.id })
  }).immediate()
  return json({ ok: true })
})
