import SharePage from "@/components/admin/share-page"
import { requireSession } from "@/lib/server/page-auth"

export default async function Page({ params }: { params: Promise<{ pollid: string }> }) {
  const { pollid } = await params
  const s = await requireSession()
  return <SharePage pollId={pollid} selfId={s.user.id} />
}
