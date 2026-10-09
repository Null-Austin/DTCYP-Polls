import Dashboard from "@/components/admin/dashboard"
import { requirePermissionPage } from "@/lib/server/page-auth"

export default async function AdminHome() {
  await requirePermissionPage("polls:read")
  return <Dashboard />
}
