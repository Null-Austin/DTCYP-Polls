import { route } from "@/lib/server/authz"
import { json } from "@/lib/server/http"
import { globalPermissions } from "@/lib/server/rbac"
import { ALL_PERMISSIONS } from "@/lib/server/permissions"

export const GET = route({ access: "authenticated" }, ({ db, user }) => {
  const shares = db.prepare(
    `SELECT p.id AS pollId, p.title, s.permission FROM poll_shares s JOIN polls p ON p.id = s.poll_id
     WHERE s.user_id = ? AND p.deleted_at IS NULL ORDER BY p.id`,
  ).all(user.id)
  const scopedPolls = [...new Set(user.grants.filter((g) => g.scope.startsWith("poll:")).map((g) => g.scope.slice(5)))].map((pollId) => ({
    pollId,
    permissions: user.grants.filter((g) => g.scope === `poll:${pollId}`).map((g) => g.permission),
  }))
  const scopedGroups = [...new Set(user.grants.filter((g) => g.scope.startsWith("group:")).map((g) => g.scope.slice(6)))].map((groupId) => ({
    groupId: Number(groupId),
    permissions: user.grants.filter((g) => g.scope === `group:${groupId}`).map((g) => g.permission),
  }))
  return json({
    account: user.username,
    kind: user.kind,
    rootadmin: user.isRoot,
    level: user.level,
    roles: user.roles.map((r) => ({ id: r.id, name: r.name, color: r.color, level: r.level })),
    permissions: globalPermissions(user),
    grants: user.isRoot ? ALL_PERMISSIONS.map((permission) => ({ permission, scope: "" })) : user.grants,
    resources: { polls: scopedPolls, groups: scopedGroups, shares },
  })
})
