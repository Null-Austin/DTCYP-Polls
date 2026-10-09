"use client"

import { useState } from "react"
import { api, errMsg, fmtDate } from "@/lib/client/api"
import { useLoad } from "@/lib/client/use-load"

type E = { id: number; at: string; action: string; targetType: string | null; targetId: string | null; details: string | null; actor: string | null; result: string; requestId: string | null; ip: string | null; userAgent: string | null; previousHash: string | null; entryHash: string | null }

const FILTERS: [string, string][] = [
  ["", "Everything"], ["login", "Logins"], ["password", "Passwords"], ["poll_", "Poll changes"], ["links_", "Link exports"],
  ["link", "Links"], ["batch", "Batches"], ["results", "Results"], ["export", "Full exports"], ["user_", "User changes"],
  ["access_denied", "Access denied"], ["settings", "Settings"], ["scheduled", "Scheduled jobs"],
]

export default function AuditPage({ canExport }: { canExport: boolean }) {
  const [filter, setFilter] = useState("")
  const [actor, setActor] = useState("")
  const [target, setTarget] = useState("")
  const [query, setQuery] = useState("")
  const [result, setResult] = useState("")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [integrity, setIntegrity] = useState("")
  const params = new URLSearchParams()
  if (filter) params.set("action", filter)
  if (actor) params.set("actor", actor)
  if (target) params.set("target", target)
  if (query) params.set("q", query)
  if (result) params.set("result", result)
  if (from) params.set("from", new Date(from).toISOString())
  if (to) params.set("to", new Date(to).toISOString())
  const path = `/api/admin/audit?${params.toString()}`
  const { data, error } = useLoad<{ entries: E[] }>(path)
  const [more, setMore] = useState<E[]>([])
  const [err, setErr] = useState("")
  const all = [...(data?.entries ?? []), ...more]
  const last = all[all.length - 1]

  async function older() {
    try {
      const r = await api<{ entries: E[] }>(`${path}&before=${last.id}`)
      setMore((m) => [...m, ...r.entries])
    } catch (e) {
      setErr(errMsg(e))
    }
  }

  async function verifyIntegrity() {
    try {
      const r = await api<{ valid: boolean; checked: number; failedId: number | null }>("/api/admin/audit/integrity")
      setIntegrity(r.valid ? `Valid: ${r.checked} entries checked` : `FAILED at entry ${r.failedId}`)
    } catch (e) { setErr(errMsg(e)) }
  }

  return (
    <>
      <h1>Audit log</h1>
      <p className="admin__sub">Logins, access attempts, poll changes, exports and account changes. IP is recorded only when configured through a trusted proxy header.</p>
      <div className="row" style={{ marginBottom: 12 }}>
        <select aria-label="Action filter" value={filter} style={{ width: 180 }} onChange={(e) => { setFilter(e.target.value); setMore([]) }}>
          {FILTERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <input aria-label="Filter by actor" placeholder="Actor" value={actor} onChange={(e) => { setActor(e.target.value); setMore([]) }} style={{ width: 150 }} />
        <input aria-label="Filter by target" placeholder="Target id" value={target} onChange={(e) => { setTarget(e.target.value); setMore([]) }} style={{ width: 140 }} />
        <input aria-label="Search audit log" placeholder="Search details" value={query} onChange={(e) => { setQuery(e.target.value); setMore([]) }} style={{ width: 180 }} />
        <select aria-label="Result" value={result} style={{ width: 120 }} onChange={(e) => { setResult(e.target.value); setMore([]) }}><option value="">Any result</option><option value="success">Success</option><option value="denied">Denied</option><option value="error">Error</option></select>
        <label className="field">From<input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setMore([]) }} /></label>
        <label className="field">To<input type="date" value={to} onChange={(e) => { setTo(e.target.value); setMore([]) }} /></label>
        <button className="btn btn--sm" onClick={() => void verifyIntegrity()}>Verify log integrity</button>
        {canExport && <><a className="btn btn--sm" href="/api/admin/audit/export?format=csv">Export CSV</a><a className="btn btn--sm" href="/api/admin/audit/export?format=json">Export JSON</a></>}
      </div>
      {integrity && <p className={integrity.startsWith("Valid") ? "ok" : "err"} role="status">{integrity}</p>}
      {(error || err) && <p className="err">{error || err}</p>}
      <div className="table-wrap">
        <table className="tbl">
          <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Target</th><th>Result</th><th>Details</th></tr></thead>
          <tbody>
            {all.map((e) => (
              <tr key={e.id}>
                <td>{fmtDate(e.at)}</td><td>{e.actor ?? "-"}</td><td>{e.action}</td>
                <td className="mono">{e.targetType ? `${e.targetType}:${e.targetId}` : ""}</td><td><span className={e.result === "success" ? "ok" : "warn"}>{e.result}</span></td>
                <td className="mono"><details><summary>{e.details ? e.details.slice(0, 60) : "View"}</summary><pre style={{ whiteSpace: "pre-wrap", maxWidth: 500 }}>{JSON.stringify({ details: e.details, requestId: e.requestId, ip: e.ip, userAgent: e.userAgent, previousHash: e.previousHash, entryHash: e.entryHash }, null, 2)}</pre></details></td>
              </tr>
            ))}
            {!all.length && <tr><td colSpan={6} className="muted">Nothing here.</td></tr>}
          </tbody>
        </table>
      </div>
      {all.length >= 100 && all.length % 100 === 0 && <p><button className="btn" onClick={older}>Load older</button></p>}
    </>
  )
}
