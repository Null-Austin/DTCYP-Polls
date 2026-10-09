import { route, requireOn } from "@/lib/server/authz"
import { exact, HttpError, intIn, json, notFound, readJson, str } from "@/lib/server/http"
import { audit } from "@/lib/server/audit"
import { nowIso } from "@/lib/server/db"
import { canGrant } from "@/lib/server/rbac"
import { ALL_PERMISSIONS, isPermission, MAX_LEVEL, PERMISSIONS } from "@/lib/server/permissions"
import type { Grant } from "@/lib/server/rbac"

const COLOR = /^#[0-9a-fA-F]{6}$/

function roleRows(db: Parameters<typeof audit>[0]) {
  return db.prepare(
    `SELECT r.id, r.name, r.color, r.level, r.position, r.is_root AS isRoot, r.created_at AS createdAt,
      (SELECT COUNT(*) FROM user_roles ur WHERE ur.role_id = r.id) AS users,
      (SELECT COUNT(*) FROM role_permissions rp WHERE rp.role_id = r.id) AS permissionCount
     FROM roles r ORDER BY r.position, r.level DESC`,
  ).all()
}

function parsePermissionList(db: Parameters<typeof audit>[0], actor: Parameters<typeof canGrant>[0], value: unknown): Grant[] {
  if (!Array.isArray(value) || value.length > 500) throw new HttpError(400, "Invalid permission list")
  const entries = value.map((x) => {
    if (typeof x === "string") {
      if (!isPermission(x)) throw new HttpError(400, "Unknown permission")
      return { permission: x, scope: "" }
    }
    if (!x || typeof x !== "object" || Array.isArray(x)) throw new HttpError(400, "Invalid permission entry")
    exact(x as Record<string, unknown>, ["permission", "scope"])
    const grant = x as { permission?: unknown; scope?: unknown }
    if (!isPermission(grant.permission) || typeof grant.scope !== "string" || !/^(|own|poll:[a-z0-9][a-z0-9-]{1,59}|group:[1-9][0-9]{0,9})$/.test(grant.scope)) {
      throw new HttpError(400, "Invalid permission scope")
    }
    return { permission: grant.permission, scope: grant.scope }
  })
  const unique = [...new Map(entries.map((g) => [`${g.permission}\0${g.scope}`, g])).values()]
  for (const g of unique) {
    if (!canGrant(actor, g.permission, g.scope)) throw new HttpError(403, `You cannot grant ${g.permission}`)
    if (g.scope.startsWith("poll:")) {
      const id = g.scope.slice(5)
      const poll = db.prepare("SELECT id, owner_id FROM polls WHERE id = ? AND deleted_at IS NULL").get(id) as { id: string; owner_id: number } | undefined
      if (!poll) throw notFound()
      requireOn(db, actor, "polls:read", { pollId: poll.id, ownerId: poll.owner_id })
    }
    if (g.scope.startsWith("group:")) {
      const id = Number(g.scope.slice(6))
      const group = db.prepare("SELECT id, poll_id FROM distribution_groups WHERE id = ?").get(id) as { id: number; poll_id: string } | undefined
      if (!group) throw notFound()
      const poll = db.prepare("SELECT owner_id FROM polls WHERE id = ? AND deleted_at IS NULL").get(group.poll_id) as { owner_id: number } | undefined
      if (!poll) throw notFound()
      requireOn(db, actor, "groups:read", { pollId: group.poll_id, ownerId: poll.owner_id, groupId: group.id })
    }
  }
  return unique
}

export const GET = route({ perm: "role:read" }, ({ db }) => {
  const roles = roleRows(db) as { id: number; name: string; color: string; level: number; position: number; isRoot: number; createdAt: string; users: number; permissionCount: number }[]
  const withPermissions = roles.map((r) => ({
    ...r,
    isRoot: !!r.isRoot,
    permissions: db.prepare("SELECT permission, scope FROM role_permissions WHERE role_id = ? ORDER BY permission, scope").all(r.id),
  }))
  return json({ roles: withPermissions, catalog: ALL_PERMISSIONS.map((permission) => ({ permission, description: PERMISSIONS[permission] })) })
})

export const POST = route({ perm: "role:create" }, async ({ req, db, user }) => {
  const body = await readJson(req, 8192)
  exact(body, ["name", "color", "level", "permissions"])
  const name = str(body.name, 50, { min: 1 })
  const color = typeof body.color === "string" ? body.color : ""
  if (!COLOR.test(color)) throw new HttpError(400, "Color must be #RRGGBB")
  const level = intIn(body.level, 0, MAX_LEVEL - 1)
  if (!user.isRoot) {
    requireOn(db, user, "role:admin")
    if (level >= user.level) throw new HttpError(403, "A role must be below your own level")
  }
  const permissions = parsePermissionList(db, user, body.permissions)
  const id = db.transaction(() => {
    const position = (db.prepare("SELECT COALESCE(MAX(position), -1) AS p FROM roles").get() as { p: number }).p + 1
    const r = db.prepare("INSERT INTO roles (name, color, level, position, created_at) VALUES (?,?,?,?,?)").run(name, color, level, position, nowIso())
    const roleId = Number(r.lastInsertRowid)
    const ins = db.prepare("INSERT INTO role_permissions (role_id, permission, scope) VALUES (?,?,?)")
    for (const g of permissions) ins.run(roleId, g.permission, g.scope)
    audit(db, user.id, "role_created", { type: "role", id: roleId }, { name, level, permission_count: permissions.length })
    return roleId
  }).immediate()
  return json({ id, roles: roleRows(db) }, 201)
})
