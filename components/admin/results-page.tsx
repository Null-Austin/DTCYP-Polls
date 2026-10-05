"use client"

import { useState } from "react"
import PollTabs from "./poll-tabs"
import { useLoad } from "@/lib/client/use-load"

type Opt = { id: number; label: string; verified: number; unverified: number }
type Data = {
  title: string
  requireVerification: boolean
  links: { generated: number; answered: number; repeats: number }
  totals: { verified: number; unverified: number; mobile: number; desktop: number }
  questions: { id: number; prompt: string; type: string; options: Opt[]; texts: { text: string; status: string }[] }[]
}

export default function ResultsPage({ pollId }: { pollId: string }) {
  const { data, error } = useLoad<Data>(`/api/admin/polls/${pollId}/results`)
  const [combine, setCombine] = useState(false)
  return (
    <>
      <h1>Results</h1>
      <p className="admin__sub">{data?.title ?? pollId}</p>
      <PollTabs pollId={pollId} current="results" />
      {error && <p className="err">{error}</p>}
      {data && (
        <>
          <div className="stats">
            <div><small>Links generated</small><strong>{data.links.generated}</strong></div>
            <div><small>Answered (verified)</small><strong className="ok">{data.links.answered}</strong></div>
            <div><small>Repeats (unverified)</small><strong className="warn">{data.links.repeats}</strong></div>
          </div>
          <div className="row" style={{ marginBottom: 16 }}>
            <label className="toggle"><input type="checkbox" checked={combine} onChange={(e) => setCombine(e.target.checked)} />Combine verified and unverified</label>
            <span className="grow" />
            <a className="btn" href={`/api/admin/polls/${pollId}/results/export`}>Export results CSV</a>
          </div>
          {data.questions.map((q) => {
            const max = Math.max(1, ...q.options.map((o) => o.verified + o.unverified))
            return (
              <section className="panel" key={q.id}>
                <h3 style={{ marginTop: 0 }}>{q.prompt}</h3>
                {q.type === "text" ? (
                  <ul>
                    {q.texts.map((t, i) => (
                      <li key={i}>{t.text} {t.status === "unverified" ? <span className="chip chip--warn">repeat</span> : <span className="chip chip--ok">verified</span>}</li>
                    ))}
                    {!q.texts.length && <li className="muted">No answers yet.</li>}
                  </ul>
                ) : (
                  q.options.map((o) => (
                    <div key={o.id} style={{ marginBottom: 12 }}>
                      <div className="row"><span className="grow">{o.label}</span>
                        {combine ? <strong>{o.verified + o.unverified}</strong> : <><span className="ok">{o.verified}</span><span className="warn">{o.unverified}</span></>}
                      </div>
                      <div className="bar" aria-hidden="true">
                        <i className="v" style={{ width: `${(o.verified / max) * 100}%` }} />
                        <i className="u" style={{ width: `${(o.unverified / max) * 100}%` }} />
                      </div>
                    </div>
                  ))
                )}
              </section>
            )
          })}
          <p className="muted">Devices: {data.totals.mobile} mobile, {data.totals.desktop} desktop.{!data.requireVerification && " Verification is off, so every answer counts as verified."}</p>
        </>
      )}
    </>
  )
}
