import SettingsPage from "@/components/admin/settings-page"
import { requireAdminPage } from "@/lib/server/page-auth"

export const metadata = { title: "Settings" }

export default async function Page() {
  await requireAdminPage()
  return <SettingsPage />
}
