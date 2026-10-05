"use client"

import { useState } from "react"

export type PollQuestion = {
  id: number
  prompt: string
  type: "single" | "multiple" | "text" | "rating"
  required: boolean
  options: { id: number; label: string }[]
}

export type AnswerPayload = { questionId: number; optionIds?: number[]; text?: string; rating?: number }

type Props = {
  title: string
  description?: string
  questions: PollQuestion[]
  notice?: string
  preview?: boolean
  onSubmit?: (answers: AnswerPayload[]) => Promise<void>
}

// Shared by the public poll page and the editor preview.
export default function PollForm({ title, description, questions, notice, preview, onSubmit }: Props) {
  const [vals, setVals] = useState<Record<number, { ids: number[]; text: string; rating?: number }>>({})
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const get = (id: number) => vals[id] ?? { ids: [], text: "" }
  const set = (id: number, patch: Partial<{ ids: number[]; text: string; rating: number }>) =>
    setVals((v) => ({ ...v, [id]: { ...get(id), ...patch } }))

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (preview || !onSubmit) return
    const answers: AnswerPayload[] = []
    for (const q of questions) {
      const v = get(q.id)
      const has = q.type === "text" ? v.text.trim() !== "" : q.type === "rating" ? v.rating !== undefined : v.ids.length > 0
      if (!has) {
        if (q.required) return setError(`Please answer: ${q.prompt}`)
        continue
      }
      answers.push(
        q.type === "text" ? { questionId: q.id, text: v.text.trim() } : q.type === "rating" ? { questionId: q.id, rating: v.rating } : { questionId: q.id, optionIds: v.ids },
      )
    }
    setError("")
    setBusy(true)
    try {
      await onSubmit(answers)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong")
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="pf" onSubmit={submit} noValidate>
      <h1 className="pf__title">{title}</h1>
      {description && <p className="pf__desc">{description}</p>}
      {notice && <p className="pf__notice" role="status">{notice}</p>}
      {questions.map((q) => {
        const v = get(q.id)
        return (
          <fieldset className="pf__q" key={q.id}>
            <legend>
              {q.prompt}
              {q.required && <span aria-label="required"> *</span>}
            </legend>
            {(q.type === "single" || q.type === "multiple") &&
              q.options.map((o) => (
                <label className="pf__opt" key={o.id}>
                  <input
                    type={q.type === "single" ? "radio" : "checkbox"}
                    name={`q${q.id}`}
                    checked={v.ids.includes(o.id)}
                    onChange={(e) =>
                      set(q.id, { ids: q.type === "single" ? [o.id] : e.target.checked ? [...v.ids, o.id] : v.ids.filter((x) => x !== o.id) })
                    }
                  />
                  <span>{o.label}</span>
                </label>
              ))}
            {q.type === "text" && (
              <textarea className="pf__text" rows={3} maxLength={2000} value={v.text} aria-label={q.prompt} onChange={(e) => set(q.id, { text: e.target.value })} />
            )}
            {q.type === "rating" && (
              <div className="pf__rating" role="radiogroup" aria-label={q.prompt}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    type="button"
                    key={n}
                    role="radio"
                    aria-checked={v.rating === n}
                    className={v.rating === n ? "is-on" : ""}
                    onClick={() => set(q.id, { rating: n })}
                  >
                    {n}
                  </button>
                ))}
              </div>
            )}
          </fieldset>
        )
      })}
      {error && <p className="pf__error" role="alert">{error}</p>}
      <button className="btn btn--primary" type="submit" disabled={busy || preview}>
        {preview ? "Submit (preview)" : busy ? "Sending..." : "Submit"}
      </button>
      <p className="pf__privacy">
        We save your answers and the time (rounded to the hour), whether you used a phone or computer, and your language.
        We do not store your IP address, name, or any cookies on this page.
      </p>
    </form>
  )
}
