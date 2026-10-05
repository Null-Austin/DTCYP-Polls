import UsersPage from "@/components/admin/users-page"
import { requireAdminPage } from "@/lib/server/page-auth"

export const metadata = { title: "Users" }

export default async function Page() {
  await requireAdminPage()
  return <UsersPage />
}
