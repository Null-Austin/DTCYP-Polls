import BackupsPage from "@/components/admin/backups-page"
import { requirePermissionPage } from "@/lib/server/page-auth"

export const metadata = { title: "Backups" }

export default async function Page() {
  await requirePermissionPage("admin:backups")
  return <BackupsPage />
}
