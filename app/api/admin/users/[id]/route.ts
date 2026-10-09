import { route, requireHigherLevelThan, requireOn } from "@/lib/server/authz"
import { exact, HttpError, json, readJson } from "@/lib/server/http"
import { destroyUserSessions } from "@/lib/server/auth"
import { audit } from "@/lib/server/audit"
import { type DB } from "@/lib/server/db"
import { canGrant, canManageRole } from "@/lib/server/rbac"
import { isPermission } from "@/lib/server/permissions"

type P = { id: string }
type Target = { id: number; is_root: number; disabled_at: string | null }

function target(db: DB, raw: string): Target {
  const id = Number(raw)
  const t = Number.isInteger(id) ? (db.prepare("SELECT id, is_root, disabled_at FROM users WHERE id = ?").get(id) as Target | undefined) : undefined
  if (!t) throw new HttpError(404, "Not found")
  return t
}

export const PATCH = route<P>({ perm: ["users:edit", "users:disable", "users:delete", "role:assign"] }, async ({ req, db, user, params }) => {
  const body = await readJson(req, 512)
  exact(body, ["roleIds", "disabled"])
  db.transaction(() => {
    const t = target(db, params.id)
    if (body.roleIds !== undefined) {
      requireOn(db, user, "role:assign")
      requireHigherLevelThan(db, user, t.id)
      if (!Array.isArray(body.roleIds) || body.roleIds.length < 1 || body.roleIds.length > 20 || body.roleIds.some((x) => !Number.isInteger(Number(x)))) {
        throw new HttpError(400, "Choose one or more roles")
      }
      const next = body.roleIds.map((x) => db.prepare("SELECT * FROM roles WHERE id = ?").get(Number(x)) as { id: number; level: number; is_root: number } | undefined)
      if (next.some((r) => !r) || next.some((r) => r!.is_root)) throw new HttpError(400, "Rootadmin cannot be assigned")
      const current = db.prepare("SELECT r.* FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ?").all(t.id) as { id: number; level: number; is_root: number }[]
      for (const r of [...current, ...next as { id: number; level: number; is_root: number }[]]) {
        if (!canManageRole(user, r)) throw new HttpError(403, "You cannot manage a role at or above your level")
        const grants = db.prepare("SELECT permission, scope FROM role_permissions WHERE role_id = ?").all(r.id) as { permission: string; scope: string }[]
        if (grants.some((g) => !isPermission(g.permission) || !canGrant(user, g.permission, g.scope))) throw new HttpError(403, "You cannot grant permissions you do not hold")
      }
      db.prepare("DELETE FROM user_roles WHERE user_id = ?").run(t.id)
      const insert = db.prepare("INSERT INTO user_roles (user_id, role_id) VALUES (?,?)")
      for (const r of next as { id: number }[]) insert.run(t.id, r.id)
      const legacyRole = (next as { id: number }[]).some((r) => (db.prepare("SELECT name FROM roles WHERE id = ?").get(r.id) as { name: string }).name === "Admin") ? "admin" : "editor"
      db.prepare("UPDATE users SET role = ? WHERE id = ?").run(legacyRole, t.id)
      destroyUserSessions(db, t.id)
      audit(db, user.id, "user_roles_changed", { type: "user", id: t.id }, { role_count: next.length })
    }
    if (body.disabled !== undefined) {
      requireOn(db, user, "users:disable")
      requireHigherLevelThan(db, user, t.id)
      if (typeof body.disabled !== "boolean") throw new HttpError(400, "Invalid input")
      if (body.disabled) {
        db.prepare("UPDATE users SET disabled_at = ? WHERE id = ?").run(new Date().toISOString(), t.id)
        destroyUserSessions(db, t.id)
      } else db.prepare("UPDATE users SET disabled_at = NULL WHERE id = ?").run(t.id)
      audit(db, user.id, body.disabled ? "user_disabled" : "user_enabled", { type: "user", id: t.id })
    }
  }).immediate()
  return json({ ok: true })
})

export const DELETE = route<P>({ perm: "users:delete" }, ({ db, user, params }) => {
  db.transaction(() => {
    const t = target(db, params.id)
    requireHigherLevelThan(db, user, t.id)
    const owned = (db.prepare("SELECT COUNT(*) AS n FROM polls WHERE owner_id = ?").get(t.id) as { n: number }).n
    if (owned) throw new HttpError(409, "Transfer or delete this account's polls before deleting the account")
    db.prepare("DELETE FROM users WHERE id = ?").run(t.id)
    audit(db, user.id, "user_deleted", { type: "user", id: t.id })
  }).immediate()
  return json({ ok: true })
})
