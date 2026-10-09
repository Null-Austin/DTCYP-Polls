import UsersPage from "@/components/admin/users-page"
import { requirePermissionPage } from "@/lib/server/page-auth"

export const metadata = { title: "Users" }

export default async function Page() {
  const s = await requirePermissionPage("users:read")
  return <UsersPage isRoot={s.user.isRoot} canAssign={s.user.isRoot || s.user.grants.some((g) => g.permission === "role:assign")} />
}
