import ResultsPage from "@/components/admin/results-page"
import { requireSession } from "@/lib/server/page-auth"

export default async function Page({ params }: { params: Promise<{ pollid: string }> }) {
  const { pollid } = await params
  const s = await requireSession()
  return <ResultsPage pollId={pollid} isAdmin={s.user.role === "admin"} />
}
