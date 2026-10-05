import AuditPage from "@/components/admin/audit-page"
import { requireAdminPage } from "@/lib/server/page-auth"

export const metadata = { title: "Audit log" }

export default async function Page() {
  await requireAdminPage()
  return <AuditPage />
}
