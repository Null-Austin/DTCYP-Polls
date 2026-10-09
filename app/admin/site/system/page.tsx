import SystemPage from "@/components/admin/system-page"
import { requirePermissionPage } from "@/lib/server/page-auth"

export const metadata = { title: "System health" }

export default async function Page() {
  await requirePermissionPage("admin:system")
  return <SystemPage />
}
