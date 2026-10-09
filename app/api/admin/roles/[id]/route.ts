import { route, requireOn } from "@/lib/server/authz"
import { exact, HttpError, intIn, json, readJson, str } from "@/lib/server/http"
import { audit } from "@/lib/server/audit"
import { canGrant, canManageRole, type Grant, type RoleRow } from "@/lib/server/rbac"
import { isPermission, MAX_LEVEL } from "@/lib/server/permissions"

const COLOR = /^#[0-9a-fA-F]{6}$/
type P = { id: string }

function getRole(db: Parameters<typeof audit>[0], id: string): RoleRow {
  const role = db.prepare("SELECT * FROM roles WHERE id = ?").get(Number(id)) as RoleRow | undefined
  if (!role) throw new HttpError(404, "Not found")
  return role
}

export const PATCH = route<P>({ perm: ["role:edit", "role:admin"] }, async ({ req, db, user, params }) => {
  const body = await readJson(req, 8192)
  exact(body, ["name", "color", "level", "position", "permissions"])
  const current = getRole(db, params.id)
  if (current.is_root) throw new HttpError(403, "rootadmin is protected")
  if (!canManageRole(user, current)) throw new HttpError(403, "You cannot manage a role at or above your level")
  const editsRole = body.name !== undefined || body.color !== undefined || body.permissions !== undefined
  const changesLevel = body.level !== undefined || body.position !== undefined
  if (editsRole) requireOn(db, user, "role:edit")
  if (changesLevel) requireOn(db, user, "role:admin")
  const name = body.name === undefined ? current.name : str(body.name, 50, { min: 1 })
  const color = body.color === undefined ? current.color : typeof body.color === "string" ? body.color : ""
  if (!COLOR.test(color)) throw new HttpError(400, "Color must be #RRGGBB")
  const level = body.level === undefined ? current.level : intIn(body.level, 0, MAX_LEVEL - 1)
  const position = body.position === undefined ? current.position : intIn(body.position, 0, 100_000)
  if (!user.isRoot && level >= user.level) throw new HttpError(403, "A role must be below your own level")
  let permissions: Grant[] | undefined
  if (body.permissions !== undefined) {
    if (!Array.isArray(body.permissions) || body.permissions.length > 500) throw new HttpError(400, "Invalid permission list")
    permissions = body.permissions.map((raw) => {
      if (typeof raw === "string") return { permission: raw, scope: "" }
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new HttpError(400, "Invalid permission entry")
      exact(raw as Record<string, unknown>, ["permission", "scope"])
      const g = raw as { permission?: unknown; scope?: unknown }
      if (!isPermission(g.permission) || typeof g.scope !== "string" || !/^(|own|poll:[a-z0-9][a-z0-9-]{1,59}|group:[1-9][0-9]{0,9})$/.test(g.scope)) throw new HttpError(400, "Invalid permission scope")
      return { permission: g.permission, scope: g.scope }
    })
    permissions = [...new Map(permissions.map((g) => [`${g.permission}\0${g.scope}`, g])).values()]
    for (const g of permissions) {
      if (!canGrant(user, g.permission, g.scope)) throw new HttpError(403, `You cannot grant ${g.permission}`)
      if (g.scope.startsWith("poll:")) {
        const id = g.scope.slice(5)
        const poll = db.prepare("SELECT id, owner_id FROM polls WHERE id = ? AND deleted_at IS NULL").get(id) as { id: string; owner_id: number } | undefined
        if (!poll) throw new HttpError(404, "Not found")
        requireOn(db, user, "polls:read", { pollId: poll.id, ownerId: poll.owner_id })
      }
      if (g.scope.startsWith("group:")) {
        const groupId = Number(g.scope.slice(6))
        const group = db.prepare("SELECT id, poll_id FROM distribution_groups WHERE id = ?").get(groupId) as { id: number; poll_id: string } | undefined
        if (!group) throw new HttpError(404, "Not found")
        const poll = db.prepare("SELECT owner_id FROM polls WHERE id = ? AND deleted_at IS NULL").get(group.poll_id) as { owner_id: number } | undefined
        if (!poll) throw new HttpError(404, "Not found")
        requireOn(db, user, "groups:read", { pollId: group.poll_id, ownerId: poll.owner_id, groupId: group.id })
      }
    }
  }
  db.transaction(() => {
    db.prepare("UPDATE roles SET name = ?, color = ?, level = ?, position = ? WHERE id = ?").run(name, color, level, position, current.id)
    if (permissions) {
      db.prepare("DELETE FROM role_permissions WHERE role_id = ?").run(current.id)
      const insert = db.prepare("INSERT INTO role_permissions (role_id, permission, scope) VALUES (?,?,?)")
      for (const g of permissions) insert.run(current.id, g.permission, g.scope)
    }
    audit(db, user.id, "role_updated", { type: "role", id: current.id }, {
      before: JSON.stringify({ name: current.name, color: current.color, level: current.level, position: current.position }),
      after: JSON.stringify({ name, color, level, position }),
      permissions_changed: permissions !== undefined,
    })
  }).immediate()
  return json({ ok: true })
})

export const DELETE = route<P>({ perm: "role:delete" }, ({ db, user, params }) => {
  const role = getRole(db, params.id)
  if (role.is_root) throw new HttpError(403, "rootadmin is protected")
  if (!canManageRole(user, role)) throw new HttpError(403, "You cannot manage a role at or above your level")
  const users = (db.prepare("SELECT COUNT(*) AS n FROM user_roles WHERE role_id = ?").get(role.id) as { n: number }).n
  if (users) throw new HttpError(409, "Remove this role from all accounts before deleting it")
  db.transaction(() => {
    db.prepare("DELETE FROM roles WHERE id = ?").run(role.id)
    audit(db, user.id, "role_deleted", { type: "role", id: role.id }, { name: role.name })
  })()
  return json({ ok: true })
})
