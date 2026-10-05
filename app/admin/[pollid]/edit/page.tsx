import PollEditor from "@/components/admin/poll-editor"

export default async function EditPage({ params }: { params: Promise<{ pollid: string }> }) {
  const { pollid } = await params
  return <PollEditor pollId={pollid} />
}
