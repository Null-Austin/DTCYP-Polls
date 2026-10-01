export default async function PollPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params

  return <div>Token: {token}</div>
}