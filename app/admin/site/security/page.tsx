import SecurityPage from "@/components/admin/security-page"
import { requirePermissionPage } from "@/lib/server/page-auth"

export const metadata = { title: "Security overview" }

export default async function Page() {
  const s = await requirePermissionPage("admin:security")
  return <SecurityPage isRoot={s.user.isRoot} />
}
