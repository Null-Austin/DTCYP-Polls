import RolesPage from "@/components/admin/roles-page"
import { requirePermissionPage } from "@/lib/server/page-auth"
import { globalPermissions } from "@/lib/server/rbac"

export const metadata = { title: "Roles" }

export default async function Page() {
  const s = await requirePermissionPage("role:read")
  return <RolesPage actor={{ isRoot: s.user.isRoot, level: s.user.level, permissions: globalPermissions(s.user), grants: s.user.grants }} />
}
