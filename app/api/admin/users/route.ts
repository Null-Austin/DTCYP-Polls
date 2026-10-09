import { route, requireOn } from "@/lib/server/authz"
import { exact, HttpError, json, readJson } from "@/lib/server/http"
import { cleanEmail, cleanUsername } from "@/lib/server/accounts"
import { generatePassword, hashPassword } from "@/lib/server/auth"
import { audit } from "@/lib/server/audit"
import { nowIso } from "@/lib/server/db"
import { canGrant, canManageRole } from "@/lib/server/rbac"
import { isPermission } from "@/lib/server/permissions"

export const GET = route({ perm: ["users:read", "users:create"] }, ({ db, user }) => {
  requireOn(db, user, "users:read")
  const users = db
    .prepare(
      `SELECT id, username, email, role, kind, is_root AS isRoot, must_change_password AS mustChangePassword, disabled_at AS disabledAt,
        created_at AS createdAt, last_login_at AS lastLoginAt FROM users ORDER BY username COLLATE NOCASE`,
    )
    .all() as { id: number }[]
  return json({
    users: users.map((u) => ({
      ...u,
      roles: db.prepare("SELECT r.id, r.name, r.color, r.level, r.is_root AS isRoot FROM roles r JOIN user_roles ur ON ur.role_id = r.id WHERE ur.user_id = ? ORDER BY r.position").all(u.id),
    })),
  })
})

export const POST = route({ perm: ["users:read", "users:create", "role:assign"] }, async ({ req, db, user }) => {
  requireOn(db, user, "users:create")
  const body = await readJson(req, 2048)
  exact(body, ["username", "email", "role", "roleIds"])
  const username = cleanUsername(body.username)
  const email = cleanEmail(body.email)
  if (body.role !== "admin" && body.role !== "editor" && body.role !== undefined) throw new HttpError(400, "Invalid role")
  if (db.prepare("SELECT 1 FROM users WHERE username = ?").get(username)) throw new HttpError(409, "Username taken")
  const temp = generatePassword()
  const hash = await hashPassword(temp)
  const id = db.transaction(() => {
    const roleName = body.role === "admin" ? "Admin" : "Editor"
    const roleRows = body.roleIds === undefined
      ? (db.prepare("SELECT * FROM roles WHERE name = ?").all(roleName) as { id: number; level: number; is_root: number }[])
      : Array.isArray(body.roleIds) && body.roleIds.length <= 20
        ? (body.roleIds.map((rid) => db.prepare("SELECT * FROM roles WHERE id = ?").get(Number(rid)) as { id: number; level: number; is_root: number } | undefined))
        : null
    if (!roleRows || !roleRows.length || roleRows.some((r) => !r)) throw new HttpError(400, "Choose at least one valid role")
    if (!user.isRoot) requireOn(db, user, "role:assign")
    for (const r of roleRows as { id: number; level: number; is_root: number }[]) {
      if (!canManageRole(user, r) || r.is_root) throw new HttpError(403, "You cannot assign that role")
      const grants = db.prepare("SELECT permission, scope FROM role_permissions WHERE role_id = ?").all(r.id) as { permission: string; scope: string }[]
      if (grants.some((g) => !isPermission(g.permission) || !canGrant(user, g.permission, g.scope))) throw new HttpError(403, "You cannot grant permissions you do not hold")
    }
    const legacyRole = (roleRows as { id: number }[]).some((r) => (db.prepare("SELECT name FROM roles WHERE id = ?").get(r.id) as { name: string }).name === "Admin") ? "admin" : "editor"
    const r = db
      .prepare("INSERT INTO users (username, email, password_hash, role, must_change_password, created_at) VALUES (?,?,?,?,1,?)")
      .run(username, email, hash, legacyRole, nowIso())
    const newId = Number(r.lastInsertRowid)
    const assign = db.prepare("INSERT INTO user_roles (user_id, role_id) VALUES (?,?)")
    for (const role of roleRows as { id: number }[]) assign.run(newId, role.id)
    audit(db, user.id, "user_created", { type: "user", id: newId }, { roles: (roleRows as { id: number }[]).length })
    return newId
  })()
  return json({ id, temporaryPassword: temp }, 201)
})
