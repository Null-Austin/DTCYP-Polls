// Dev-only preview of the shared poll form (proxy.ts returns 404 for /test in production).
import PollForm from "@/components/poll/poll-form"

const SAMPLE = [
  { id: 1, prompt: "Which do you prefer?", type: "single" as const, required: true, options: [{ id: 1, label: "Option A" }, { id: 2, label: "Option B" }] },
  { id: 2, prompt: "Tell us more", type: "text" as const, required: false, options: [] },
  { id: 3, prompt: "How was it?", type: "rating" as const, required: false, options: [] },
]

export default async function PollPreviewPage({ params }: { params: Promise<{ token: string }> }) {
  await params
  return (
    <main className="pub">
      <section className="pub__card">
        <PollForm title="Sample poll" description="Preview only. Nothing is saved." questions={SAMPLE} preview />
      </section>
    </main>
  )
}
