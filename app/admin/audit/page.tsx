import AuditPage from "@/components/admin/audit-page"
import { requirePermissionPage } from "@/lib/server/page-auth"

export const metadata = { title: "Audit log" }

export default async function Page() {
  const s = await requirePermissionPage("audit:read")
  return <AuditPage canExport={s.user.isRoot || s.user.grants.some((g) => g.permission === "audit:export")} />
}
