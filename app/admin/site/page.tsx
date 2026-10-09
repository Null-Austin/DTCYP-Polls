import AdminHub from "@/components/admin/admin-hub"
import { requireAdminPage } from "@/lib/server/page-auth"
import { globalPermissions } from "@/lib/server/rbac"

export const metadata = { title: "Admin" }

export default async function Page() {
  const s = await requireAdminPage()
  return <AdminHub permissions={globalPermissions(s.user)} isRoot={s.user.isRoot} />
}
