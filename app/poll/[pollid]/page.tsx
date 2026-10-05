import type { Metadata } from "next"
import PublicPoll from "@/components/poll/public-poll"

export const metadata: Metadata = { title: "Poll", robots: { index: false, follow: false }, referrer: "no-referrer" }

export default async function PollPage({
  params,
  searchParams,
}: {
  params: Promise<{ pollid: string }>
  searchParams: Promise<{ t?: string | string[] }>
}) {
  const { pollid } = await params
  const { t } = await searchParams
  return <PublicPoll pollId={pollid} token={typeof t === "string" ? t : ""} />
}
