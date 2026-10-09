import type { DB } from "./db"
import { ALL_PERMISSIONS, SHARE_EDIT, SHARE_VIEW, MAX_LEVEL, type Permission } from "./permissions"

export type RoleRow = { id: number; name: string; color: string; level: number; position: number; is_root: number; created_at: string }
// scope: '' everywhere | 'own' | 'poll:<id>' | 'group:<id>'
export type Grant = { permission: string; scope: string }

export type Actor = {
  id: number
  username: string
  email: string | null
  kind: "human" | "bot"
  isRoot: boolean
  mustChangePassword: boolean
  level: number
  roles: RoleRow[]
  grants: Grant[]
  via: "session" | "token"
  // Transitional compatibility for existing screens; authorization never trusts this label.
  role: "admin" | "editor"
  must_change_password: number
  disabled_at: null
}

type UserRow = { id: number; username: string; email: string | null; kind: "human" | "bot"; is_root: number; must_change_password: number }

export function loadActor(db: DB, userId: number, via: "session" | "token" = "session"): Actor | null {
  const u = db.prepare("SELECT id, username, email, kind, is_root, must_change_password FROM users WHERE id = ? AND disabled_at IS NULL").get(userId) as UserRow | undefined
  if (!u) return null
  const roles = db
    .prepare("SELECT r.* FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ? ORDER BY r.level DESC, r.position")
    .all(userId) as RoleRow[]
  const grants = db
    .prepare("SELECT DISTINCT rp.permission, rp.scope FROM role_permissions rp JOIN user_roles ur ON ur.role_id = rp.role_id WHERE ur.user_id = ?")
    .all(userId) as Grant[]
  const isRoot = !!u.is_root
  return {
    id: u.id,
    username: u.username,
    email: u.email,
    kind: u.kind,
    isRoot,
    mustChangePassword: !!u.must_change_password,
    level: isRoot ? MAX_LEVEL : Math.max(0, ...roles.map((r) => r.level)),
    roles,
    grants,
    via,
    role: isRoot || grants.some((g) => g.permission.startsWith("admin:")) || roles.some((r) => r.name === "Admin") ? "admin" : "editor",
    must_change_password: u.must_change_password,
    disabled_at: null,
  }
}

export type Resource = { pollId?: string; ownerId?: number; groupId?: number; batchId?: number }

export function shareLevel(db: DB, actor: Actor, pollId: string): "view" | "edit" | null {
  const s = db.prepare("SELECT permission FROM poll_shares WHERE poll_id = ? AND user_id = ?").get(pollId, actor.id) as { permission: "view" | "edit" } | undefined
  return s?.permission ?? null
}

// The single place that answers "may this account do X (to this resource)?". Rootadmin holds everything.
export function can(db: DB, actor: Actor, perm: Permission, res: Resource = {}): boolean {
  if (actor.isRoot) return true
  for (const g of actor.grants) {
    if (g.permission !== perm) continue
    if (g.scope === "") return true
    if (g.scope === "own" && res.ownerId !== undefined && res.ownerId === actor.id) return true
    if (res.pollId && g.scope === `poll:${res.pollId}`) return true
    if (res.groupId !== undefined && g.scope === `group:${res.groupId}`) return true
    if (res.batchId !== undefined && g.scope === `group:${res.batchId}`) return true
  }
  if (res.pollId) {
    const lvl = shareLevel(db, actor, res.pollId)
    if (lvl === "view" && SHARE_VIEW.includes(perm)) return true
    if (lvl === "edit" && SHARE_EDIT.includes(perm)) return true
  }
  return false
}

// Route-level gate: does the account hold this permission in any scope, or via any poll share?
export function holdsAnywhere(db: DB, actor: Actor, perm: Permission): boolean {
  if (actor.isRoot || actor.grants.some((g) => g.permission === perm)) return true
  if (SHARE_VIEW.includes(perm) || SHARE_EDIT.includes(perm)) {
    return !!db.prepare("SELECT 1 FROM poll_shares WHERE user_id = ? LIMIT 1").get(actor.id)
  }
  return false
}

export function globalPermissions(actor: Actor): Permission[] {
  if (actor.isRoot) return [...ALL_PERMISSIONS]
  return ALL_PERMISSIONS.filter((p) => actor.grants.some((g) => g.permission === p && g.scope === ""))
}

// ---- hierarchy ----

export type Rankable = { id: number; level: number; isRoot: boolean }

// "Strictly higher level" (Discord-style). The ONE place to change if equal levels should be allowed.
export function outranks(actor: Rankable, target: Rankable): boolean {
  if (actor.id === target.id) return false
  if (target.isRoot) return false
  if (actor.isRoot) return true
  return actor.level > target.level
}

// A role may be given or taken away only if it is below the actor's own level and is not the root role.
export function canManageRole(actor: Actor, role: Pick<RoleRow, "level" | "is_root">): boolean {
  if (role.is_root) return false
  return actor.isRoot || role.level < actor.level
}

// An actor may only hand out permissions they hold themselves, in a scope they cover.
export function canGrant(actor: Actor, perm: string, scope: string): boolean {
  if (actor.isRoot) return true
  return actor.grants.some((g) => g.permission === perm && (g.scope === "" || g.scope === scope))
}

export function rankableOfUser(db: DB, userId: number): Rankable & { kind: "human" | "bot"; username: string } | null {
  const a = loadActor(db, userId)
  if (a) return { id: a.id, level: a.level, isRoot: a.isRoot, kind: a.kind, username: a.username }
  // disabled accounts still have a rank
  const u = db.prepare("SELECT id, username, kind, is_root FROM users WHERE id = ?").get(userId) as { id: number; username: string; kind: "human" | "bot"; is_root: number } | undefined
  if (!u) return null
  const lvl = (db.prepare("SELECT COALESCE(MAX(r.level), 0) AS l FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ?").get(userId) as { l: number }).l
  return { id: u.id, level: u.is_root ? MAX_LEVEL : lvl, isRoot: !!u.is_root, kind: u.kind, username: u.username }
}

// SQL fragment: polls this actor may at least read. Uses alias p.
export function visiblePolls(db: DB, actor: Actor, permission: Permission = "polls:read"): { sql: string; args: (string | number)[] } {
  void db
  if (actor.isRoot || actor.grants.some((g) => g.permission === permission && g.scope === "")) return { sql: "1=1", args: [] }
  const shareEligible = SHARE_VIEW.includes(permission) || SHARE_EDIT.includes(permission)
  const shareEditOnly = !SHARE_VIEW.includes(permission) && SHARE_EDIT.includes(permission)
  const parts: string[] = []
  const args: (string | number)[] = []
  if (shareEligible) {
    parts.push(`EXISTS (SELECT 1 FROM poll_shares s WHERE s.poll_id = p.id AND s.user_id = ? ${shareEditOnly ? "AND s.permission = 'edit'" : ""})`)
    args.push(actor.id)
  }
  const reads = actor.grants.filter((g) => g.permission === permission)
  if (reads.some((g) => g.scope === "own")) {
    parts.push("p.owner_id = ?")
    args.push(actor.id)
  }
  const ids = reads.filter((g) => g.scope.startsWith("poll:")).map((g) => g.scope.slice(5))
  if (ids.length) {
    parts.push(`p.id IN (${ids.map(() => "?").join(",")})`)
    args.push(...ids)
  }
  if (!parts.length) return { sql: "0=1", args: [] }
  return { sql: `(${parts.join(" OR ")})`, args }
}

export function accessLevel(db: DB, actor: Actor, p: { id: string; owner_id: number }): "owner" | "edit" | "view" {
  const res = { pollId: p.id, ownerId: p.owner_id }
  if (can(db, actor, "polls:delete", res) && can(db, actor, "polls:share", res)) return "owner"
  return can(db, actor, "polls:edit", res) ? "edit" : "view"
}
