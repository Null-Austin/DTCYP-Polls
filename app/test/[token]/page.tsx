// app/test/[token]/page.tsx

import Poll from "@/components/Poll"

export default async function PollPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params

  const poll = await token

  return <Poll poll={poll} />
}