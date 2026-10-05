"use client"

import { useCallback, useEffect, useState } from "react"
import PollForm, { type PollQuestion } from "@/components/poll/poll-form"
import PollLogo from "@/components/poll/logo"
import { api, ApiError } from "@/lib/client/api"

type View = { title: string; description: string; state: "open" | "closed" | "not_open"; questions: PollQuestion[] }
type Phase = { k: "loading" } | { k: "invalid" } | { k: "error"; msg: string } | { k: "ready"; v: View } | { k: "done" }

export default function PublicPoll({ pollId, token }: { pollId: string; token: string }) {
  const [phase, setPhase] = useState<Phase>({ k: "loading" })

  const load = useCallback(async () => {
    setPhase({ k: "loading" })
    try {
      const v = await api<View>(`/api/polls/${encodeURIComponent(pollId)}?t=${encodeURIComponent(token)}`)
      setPhase({ k: "ready", v })
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setPhase({ k: "invalid" })
      else setPhase({ k: "error", msg: e instanceof Error ? e.message : "Error" })
    }
  }, [pollId, token])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data fetch
    void load()
  }, [load])

  let body: React.ReactNode
  if (phase.k === "loading") body = <p className="pub__msg">Loading...</p>
  else if (phase.k === "invalid") body = <Msg title="This link isn't valid" text="Check that you copied the whole link. It may have been withdrawn." />
  else if (phase.k === "error")
    body = (
      <div className="pub__msg">
        <p>{phase.msg}</p>
        <button className="btn btn--primary" onClick={load}>Retry</button>
      </div>
    )
  else if (phase.k === "done") body = <Msg title="Thank you" text="Your answer has been saved." />
  else if (phase.v.state === "closed") body = <Msg title={phase.v.title} text="This poll is closed." />
  else if (phase.v.state === "not_open") body = <Msg title={phase.v.title} text="This poll isn't open yet. Please check back later." />
  else {
    const v = phase.v
    body = (
      <PollForm
        title={v.title}
        description={v.description}
        questions={v.questions}
        onSubmit={async (answers) => {
          try {
            await api(`/api/polls/${encodeURIComponent(pollId)}/responses`, { method: "POST", body: { token, answers } })
            setPhase({ k: "done" })
          } catch (e) {
            if (e instanceof ApiError && (e.status === 404 || e.status === 409)) await load()
            else throw e
          }
        }}
      />
    )
  }

  return (
    <main className="pub">
      <header className="pub__head"><PollLogo /></header>
      <section className="pub__card">{body}</section>
    </main>
  )
}

function Msg({ title, text }: { title: string; text: string }) {
  return (
    <div className="pub__msg">
      <h1>{title}</h1>
      <p>{text}</p>
    </div>
  )
}
