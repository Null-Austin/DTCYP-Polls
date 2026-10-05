import LinksPage from "@/components/admin/links-page"

export default async function Page({ params }: { params: Promise<{ pollid: string }> }) {
  const { pollid } = await params
  return <LinksPage pollId={pollid} />
}
