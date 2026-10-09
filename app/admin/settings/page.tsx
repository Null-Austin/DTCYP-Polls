import SettingsPage from "@/components/admin/settings-page"
import { requirePermissionPage } from "@/lib/server/page-auth"

export const metadata = { title: "Settings" }

export default async function Page() {
  await requirePermissionPage("admin:settings")
  return <SettingsPage />
}
