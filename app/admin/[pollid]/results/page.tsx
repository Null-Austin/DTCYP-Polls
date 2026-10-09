import ResultsPage from "@/components/admin/results-page"
import { requireSession } from "@/lib/server/page-auth"
import { globalPermissions } from "@/lib/server/rbac"

export default async function Page({ params }: { params: Promise<{ pollid: string }> }) {
  const { pollid } = await params
  const s = await requireSession()
  const permissions = globalPermissions(s.user)
  return <ResultsPage pollId={pollid} isAdmin={permissions.includes("admin:export")} />
}
