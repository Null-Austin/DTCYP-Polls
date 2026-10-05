"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import PollForm from "@/components/poll/poll-form"
import PollTabs from "./poll-tabs"
import { api, errMsg } from "@/lib/client/api"
import { useLoad } from "@/lib/client/use-load"

type QType = "single" | "multiple" | "text" | "rating"
type Opt = { key: string; id?: number; label: string }
type Q = { key: string; id?: number; prompt: string; type: QType; required: boolean; open: boolean; options: Opt[] }
type Dto = {
  id: string; title: string; description: string; status: "draft" | "open" | "closed"; requireVerification: boolean
  opensAt: string | null; closesAt: string | null; hasResponses: boolean
  questions: { id: number; prompt: string; type: QType; required: boolean; options: { id: number; label: string }[] }[]
}
type Draft = { title: string; description: string; status: Dto["status"]; requireVerification: boolean; opensAt: string; closesAt: string; questions: Q[] }

const TYPES: [QType, string][] = [["single", "Single choice"], ["multiple", "Multiple choice"], ["text", "Free text"], ["rating", "Rating (1-5)"]]
let counter = 0
const key = () => `k${++counter}`
const toLocal = (iso: string | null) => {
  if (!iso) return ""
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}
const toDraft = (d: Dto): Draft => ({
  title: d.title, description: d.description, status: d.status, requireVerification: d.requireVerification,
  opensAt: toLocal(d.opensAt), closesAt: toLocal(d.closesAt),
  questions: d.questions.map((q, i) => ({ key: key(), id: q.id, prompt: q.prompt, type: q.type, required: q.required, open: i === 0, options: q.options.map((o) => ({ key: key(), id: o.id, label: o.label })) })),
})

export default function PollEditor({ pollId }: { pollId: string }) {
  const { data, error, reload } = useLoad<Dto>(`/api/admin/polls/${pollId}`)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [base, setBase] = useState("")
  const [saved, setSaved] = useState("")
  const [err, setErr] = useState("")
  const [busy, setBusy] = useState(false)
  const dragFrom = useRef<{ q: string; o: string } | null>(null)
  const [over, setOver] = useState("")

  useEffect(() => {
    if (!data) return
    const d = toDraft(data)
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync server state into the editable draft
    setDraft(d)
    setBase(JSON.stringify(strip(d)))
  }, [data])

  const dirty = !!draft && JSON.stringify(strip(draft)) !== base
  useEffect(() => {
    if (!dirty) return
    const h = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener("beforeunload", h)
    return () => window.removeEventListener("beforeunload", h)
  }, [dirty])

  const preview = useMemo(
    () => draft?.questions.map((q, i) => ({ id: i + 1, prompt: q.prompt || "(untitled)", type: q.type, required: q.required, options: q.options.map((o, j) => ({ id: j + 1, label: o.label || "(empty)" })) })) ?? [],
    [draft],
  )
  if (error) return <p className="err">{error}</p>
  if (!draft || !data) return <p className="muted">Loading...</p>
  const locked = data.hasResponses
  const upd = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch })
  const updQ = (k: string, patch: Partial<Q>) => upd({ questions: draft.questions.map((q) => (q.key === k ? { ...q, ...patch } : q)) })
  const move = <T,>(arr: T[], from: number, to: number) => {
    const c = [...arr]
    c.splice(to, 0, c.splice(from, 1)[0])
    return c
  }

  async function save() {
    if (!draft) return
    setBusy(true)
    setErr("")
    try {
      const body = {
        title: draft.title, description: draft.description, status: draft.status, requireVerification: draft.requireVerification,
        opensAt: draft.opensAt ? new Date(draft.opensAt).toISOString() : null,
        closesAt: draft.closesAt ? new Date(draft.closesAt).toISOString() : null,
        questions: draft.questions.map((q) => ({ id: q.id, prompt: q.prompt, type: q.type, required: q.required, options: q.options.map((o) => ({ id: o.id, label: o.label })) })),
      }
      await api(`/api/admin/polls/${pollId}`, { method: "PATCH", body })
      await reload()
      setSaved("Saved just now")
    } catch (e) {
      setErr(errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <h1>Edit poll</h1>
      <p className="admin__sub mono">{pollId}</p>
      <PollTabs pollId={pollId} current="edit" />
      <div className="editor">
        <div>
          {locked && <p className="pf__notice">This poll has responses. You can reword and reorder, but not add, remove or retype questions and options. Duplicate the poll to restructure it.</p>}
          <label className="field">Poll title<input value={draft.title} maxLength={200} onChange={(e) => upd({ title: e.target.value })} /></label>
          <label className="field" style={{ marginTop: 12 }}>Description (optional)<textarea rows={2} maxLength={2000} value={draft.description} onChange={(e) => upd({ description: e.target.value })} /></label>
          <div className="seg" role="group" aria-label="Status" style={{ margin: "16px 0" }}>
            {(["draft", "open", "closed"] as const).map((s) => (
              <button key={s} aria-pressed={draft.status === s} onClick={() => upd({ status: s })}>{s[0].toUpperCase() + s.slice(1)}</button>
            ))}
          </div>
          <div className="row" style={{ marginBottom: 16 }}>
            <label className="field grow">Opens at (optional)<input type="datetime-local" value={draft.opensAt} onChange={(e) => upd({ opensAt: e.target.value })} /></label>
            <label className="field grow">Closes at (optional)<input type="datetime-local" value={draft.closesAt} onChange={(e) => upd({ closesAt: e.target.value })} /></label>
          </div>

          {draft.questions.map((q, qi) => (
            <section className="qcard" key={q.key}>
              <button className="qcard__head" aria-expanded={q.open} onClick={() => updQ(q.key, { open: !q.open })}>
                <span><small className="muted">Question {qi + 1}</small><br /><strong>{q.prompt || "Untitled question"}</strong></span>
                <span>{q.open ? "−" : "+"}</span>
              </button>
              {q.open && (
                <div className="qcard__body">
                  <input aria-label="Question prompt" value={q.prompt} maxLength={300} onChange={(e) => updQ(q.key, { prompt: e.target.value })} />
                  <div className="row">
                    <select aria-label="Question type" disabled={locked} value={q.type} style={{ width: 200 }}
                      onChange={(e) => {
                        const type = e.target.value as QType
                        const choice = type === "single" || type === "multiple"
                        updQ(q.key, { type, options: choice ? (q.options.length ? q.options : [{ key: key(), label: "" }, { key: key(), label: "" }]) : [] })
                      }}>
                      {TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                    <label className="toggle"><input type="checkbox" checked={q.required} onChange={(e) => updQ(q.key, { required: e.target.checked })} />Required</label>
                    <span className="grow" />
                    <button className="btn btn--sm" disabled={qi === 0} onClick={() => upd({ questions: move(draft.questions, qi, qi - 1) })} aria-label="Move up">↑</button>
                    <button className="btn btn--sm" disabled={qi === draft.questions.length - 1} onClick={() => upd({ questions: move(draft.questions, qi, qi + 1) })} aria-label="Move down">↓</button>
                    <button className="btn btn--sm btn--danger" disabled={locked} onClick={() => upd({ questions: draft.questions.filter((x) => x.key !== q.key) })}>Delete</button>
                  </div>
                  {(q.type === "single" || q.type === "multiple") && (
                    <>
                      {q.options.map((o, oi) => (
                        <div key={o.key} className={`opt ${over === o.key ? "is-over" : ""}`} draggable
                          onDragStart={() => (dragFrom.current = { q: q.key, o: o.key })}
                          onDragOver={(e) => { if (dragFrom.current?.q === q.key) { e.preventDefault(); setOver(o.key) } }}
                          onDragLeave={() => setOver("")}
                          onDrop={() => {
                            const from = q.options.findIndex((x) => x.key === dragFrom.current?.o)
                            if (from >= 0) updQ(q.key, { options: move(q.options, from, oi) })
                            dragFrom.current = null
                            setOver("")
                          }}>
                          <span className="handle" aria-hidden="true">⋮⋮</span>
                          <input aria-label={`Option ${oi + 1}`} value={o.label} maxLength={200} onChange={(e) => updQ(q.key, { options: q.options.map((x) => (x.key === o.key ? { ...x, label: e.target.value } : x)) })} />
                          <button className="btn btn--quiet btn--sm" aria-label="Move option up" disabled={oi === 0} onClick={() => updQ(q.key, { options: move(q.options, oi, oi - 1) })}>↑</button>
                          <button className="btn btn--quiet btn--sm" aria-label="Delete option" disabled={locked || q.options.length <= 2} onClick={() => updQ(q.key, { options: q.options.filter((x) => x.key !== o.key) })}>✕</button>
                        </div>
                      ))}
                      <div><button className="btn btn--primary btn--sm" disabled={locked || q.options.length >= 30} onClick={() => updQ(q.key, { options: [...q.options, { key: key(), label: "" }] })}>Add option</button></div>
                    </>
                  )}
                </div>
              )}
            </section>
          ))}
          <button className="btn" disabled={locked || draft.questions.length >= 50}
            onClick={() => upd({ questions: [...draft.questions.map((q) => ({ ...q, open: false })), { key: key(), prompt: "", type: "single", required: true, open: true, options: [{ key: key(), label: "" }, { key: key(), label: "" }] }] })}>
            Add question
          </button>

          {err && <p className="err" role="alert" style={{ marginTop: 16 }}>{err}</p>}
          <div className="row" style={{ marginTop: 24 }}>
            <button className="btn btn--primary" disabled={busy || !dirty} onClick={save}>Save</button>
            <button className="btn" disabled={busy || !dirty} onClick={() => { setDraft(toDraft(data)); setErr("") }}>Discard</button>
            <small className="muted">{dirty ? "Unsaved changes" : saved}</small>
          </div>
        </div>

        <aside className="preview" aria-label="Preview">
          <h2 style={{ marginTop: 0 }}>Preview</h2>
          <div className="light"><PollForm title={draft.title || "Untitled"} description={draft.description} questions={preview} preview /></div>
          <div style={{ marginTop: 16 }}>
            <label className="toggle">
              <input type="checkbox" checked={draft.requireVerification} onChange={(e) => upd({ requireVerification: e.target.checked })} />
              Require verification
            </label>
            <p className="muted" style={{ fontSize: 12 }}>On: the first answer per link is verified, repeats are marked unverified. Off: every answer counts as verified.</p>
          </div>
        </aside>
      </div>
    </>
  )
}

// Keys and UI flags are not part of "dirty".
function strip(d: Draft) {
  return { ...d, questions: d.questions.map((q) => ({ prompt: q.prompt, type: q.type, required: q.required, id: q.id, options: q.options.map((o) => ({ id: o.id, label: o.label })) })) }
}
