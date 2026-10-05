import PollsList from "@/components/admin/polls-list"
import { requireSession } from "@/lib/server/page-auth"

export const metadata = { title: "Polls" }

export default async function PollsPage() {
  const s = await requireSession()
  return <PollsList isAdmin={s.user.role === "admin"} />
}
