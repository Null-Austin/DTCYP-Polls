import BotsPage from "@/components/admin/bots-page"
import { requireSession } from "@/lib/server/page-auth"
import { globalPermissions } from "@/lib/server/rbac"

export const metadata = { title: "API tokens" }

export default async function Page() {
  const s = await requireSession()
  const permissions = globalPermissions(s.user)
  return <BotsPage canRead={permissions.includes("tokens:read")} canCreate={permissions.includes("tokens:create")} canRevoke={permissions.includes("tokens:revoke")} canAssign={permissions.includes("role:assign")} />
}
