"use client"

import { useState } from "react"
import PollTabs from "./poll-tabs"
import { api, errMsg, fmtDate } from "@/lib/client/api"
import { useLoad } from "@/lib/client/use-load"
import GroupsPanel from "./groups-panel"

type Batch = { id: number; label: string; count: number; createdAt: string; revoked: number; verified: number; unverified: number }
type Data = {
  pollTitle: string
  access: "view" | "edit" | "owner"
  stats: { generated: number; answered: number; repeats: number }
  batches: Batch[]
  matches?: { token: string; revokedAt: string | null; label: string; verified: number; unverified: number }[]
}

const exportUrl = (id: number, f: string) => `/api/admin/batches/${id}/export?format=${f}`

export default function LinksPage({ pollId }: { pollId: string }) {
  const [search, setSearch] = useState("")
  const { data, error, reload } = useLoad<Data>(`/api/admin/polls/${pollId}/links${search ? `?q=${encodeURIComponent(search)}` : ""}`)
  const [input, setInput] = useState("50")
  const [label, setLabel] = useState("")
  const [format, setFormat] = useState<"csv" | "txt">("csv")
  const [sel, setSel] = useState<number | null>(null)
  const [toast, setToast] = useState("")
  const [err, setErr] = useState("")
  const [busy, setBusy] = useState(false)
  const source = input.trim()
  const titles = source && !/^\d+$/.test(source) ? (source.includes("\n") ? source.split(/\r?\n/) : source.split(",")).map((x) => x.trim()).filter(Boolean) : []
  const previewCount = /^\d+$/.test(source) ? Number(source) : titles.length
  const duplicates = [...new Set(titles.filter((t, i) => titles.findIndex((x) => x.toLowerCase() === t.toLowerCase()) !== i))]
  const flash = (m: string) => {
    setToast(m)
    setTimeout(() => setToast(""), 3500)
  }

  async function generate() {
    setBusy(true)
    setErr("")
    try {
      const r = await api<{ batchId: number; count: number; duplicateTitles: string[] }>(`/api/admin/polls/${pollId}/links`, { method: "POST", body: { input, label } })
      window.location.assign(exportUrl(r.batchId, format))
      flash(`${r.count} URLs ready${r.duplicateTitles.length ? `; ${r.duplicateTitles.length} duplicate titles` : ""}`)
      setLabel("")
      setInput("50")
      await reload()
    } catch (e) {
      setErr(errMsg(e))
    } finally {
      setBusy(false)
    }
  }
  async function copy(id: number) {
    const res = await fetch(exportUrl(id, "txt"), { credentials: "same-origin" })
    if (!res.ok) return setErr("Could not copy")
    await navigator.clipboard.writeText(await res.text())
    flash("Links copied")
  }
  async function revokeBatch(b: Batch) {
    if (!confirm(`Revoke all ${b.count} links in this batch? They will stop working.`)) return
    try {
      await api(`/api/admin/batches/${b.id}/revoke`, { method: "POST" })
      await reload()
    } catch (e) {
      setErr(errMsg(e))
    }
  }
  async function revokeLink(token: string) {
    if (!confirm("Revoke this link?")) return
    try {
      await api(`/api/admin/polls/${pollId}/links/revoke`, { method: "POST", body: { token } })
      await reload()
    } catch (e) {
      setErr(errMsg(e))
    }
  }

  return (
    <>
      <h1>Export links</h1>
      <p className="admin__sub">{data?.pollTitle ?? pollId}</p>
      <PollTabs pollId={pollId} current="links" canLinks={data?.access !== "view"} canResults canShare={data?.access === "owner"} />
      {toast && <div className="toast" role="status">✅ {toast}</div>}
      {(error || err) && <p className="err" role="alert">{error || err}</p>}

      <section className="panel" hidden={data?.access === "view"}>
        <div className="form">
          <label>Batch label (optional)<input value={label} maxLength={100} onChange={(e) => setLabel(e.target.value)} placeholder="April 10th" /></label>
          <label className="field">Add URLs: enter a count, one title per line, or comma-separated titles
            <textarea rows={4} maxLength={100000} value={input} onChange={(e) => setInput(e.target.value)} />
          </label>
          <p className="muted">This will create {previewCount || 0} URLs.{duplicates.length > 0 && <span className="warn"> Duplicate titles: {duplicates.join(", ")}</span>}</p>
          <div className="chips" aria-label="Quick counts">{[10, 25, 50, 100].map((n) => <button key={n} aria-pressed={input === String(n)} onClick={() => setInput(String(n))}>{n}</button>)}</div>
          <div className="field">
            <span id="fmt-lbl">Format</span>
            <div className="seg" role="group" aria-labelledby="fmt-lbl">
              <button aria-pressed={format === "csv"} onClick={() => setFormat("csv")}>CSV</button>
              <button aria-pressed={format === "txt"} onClick={() => setFormat("txt")}>Plain text</button>
            </div>
          </div>
          <div><button className="btn btn--primary" disabled={busy || !previewCount || previewCount > 10000} onClick={generate}>Generate &amp; download</button></div>
        </div>
      </section>

      <h2>Previous batches</h2>
      <div className="table-wrap" style={{ marginBottom: 20 }}>
        <table className="tbl">
          <thead><tr><th>Batch label</th><th>Count</th><th>Date</th><th>Responses received</th><th /></tr></thead>
          <tbody>
            {data?.batches.map((b) => (
              <tr key={b.id} className={sel === b.id ? "is-sel" : ""} onClick={() => setSel(b.id)} aria-selected={sel === b.id}>
                <td>{b.label || <span className="muted">(none)</span>}{b.revoked > 0 && <span className="chip chip--warn" style={{ marginLeft: 8 }}>{b.revoked} revoked</span>}</td>
                <td>{b.count}</td>
                <td>{fmtDate(b.createdAt)}</td>
                <td><span className="ok">{b.verified} ✅</span> <span className="warn">{b.unverified} ⚠️</span></td>
                <td>
                  <div className="actions" hidden={data.access === "view"}>
                    <button className="copy" aria-label="Copy links" title="Copy links" onClick={(e) => { e.stopPropagation(); void copy(b.id) }}>⧉</button>
                    <a className="btn btn--sm" href={exportUrl(b.id, "csv")}>CSV</a>
                    <a className="btn btn--sm" href={exportUrl(b.id, "txt")}>TXT</a>
                    <button className="btn btn--sm btn--danger" onClick={(e) => { e.stopPropagation(); void revokeBatch(b) }}>Revoke</button>
                  </div>
                </td>
              </tr>
            ))}
            {data && !data.batches.length && <tr><td colSpan={5} className="muted">No batches yet.</td></tr>}
          </tbody>
        </table>
      </div>

      <label className="field" style={{ maxWidth: 360, marginBottom: 12 }}>Find a link by token
        <input value={search} maxLength={64} onChange={(e) => setSearch(e.target.value)} placeholder="Part of a token" />
      </label>
      {data?.matches && (
        <div className="table-wrap" style={{ marginBottom: 20 }}>
          <table className="tbl">
            <tbody>
              {data.matches.map((m) => (
                <tr key={m.token}>
                  <td className="mono">{m.token}</td><td>{m.label}</td>
                  <td><span className="ok">{m.verified} verified</span> <span className="warn">{m.unverified} repeat</span></td>
                  <td>{m.revokedAt ? <span className="chip chip--warn">revoked</span> : <button className="btn btn--sm btn--danger" onClick={() => revokeLink(m.token)}>Revoke</button>}</td>
                </tr>
              ))}
              {!data.matches.length && <tr><td className="muted">No match.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {data && (
        <div className="stats">
          <div><small>Links generated</small><strong>{data.stats.generated}</strong></div>
          <div><small>Answered (verified)</small><strong className="ok">{data.stats.answered} ✅</strong></div>
          <div><small>Repeat answers (unverified)</small><strong className="warn">{data.stats.repeats} ⚠️</strong></div>
        </div>
      )}
      {data && <GroupsPanel pollId={pollId} editable={data.access !== "view"} exportable={data.access !== "view"} />}
    </>
  )
}
