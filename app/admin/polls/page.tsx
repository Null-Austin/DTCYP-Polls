import PollsList from "@/components/admin/polls-list"
import { requirePermissionPage } from "@/lib/server/page-auth"
import { globalPermissions } from "@/lib/server/rbac"

export const metadata = { title: "Polls" }

export default async function PollsPage() {
  const s = await requirePermissionPage("polls:read")
  return <PollsList permissions={globalPermissions(s.user)} isRoot={s.user.isRoot} />
}
