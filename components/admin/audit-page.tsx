"use client"

import { useState } from "react"
import { api, errMsg, fmtDate } from "@/lib/client/api"
import { useLoad } from "@/lib/client/use-load"

type E = { id: number; at: string; action: string; targetType: string | null; targetId: string | null; details: string | null; actor: string | null }

const FILTERS: [string, string][] = [
  ["", "Everything"], ["login", "Logins"], ["password", "Passwords"], ["poll_", "Poll changes"], ["links_", "Link exports"],
  ["link", "Links"], ["batch", "Batches"], ["results", "Results"], ["export", "Full exports"], ["user_", "User changes"],
  ["access_denied", "Access denied"], ["settings", "Settings"], ["scheduled", "Scheduled jobs"],
]

export default function AuditPage() {
  const [filter, setFilter] = useState("")
  const path = `/api/admin/audit?action=${encodeURIComponent(filter)}`
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

  return (
    <>
      <h1>Audit log</h1>
      <p className="admin__sub">Logins, access attempts, poll changes, exports and user changes. No IP addresses are recorded.</p>
      <div className="row" style={{ marginBottom: 12 }}>
        <select aria-label="Filter" value={filter} style={{ width: 200 }} onChange={(e) => { setFilter(e.target.value); setMore([]) }}>
          {FILTERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>
      {(error || err) && <p className="err">{error || err}</p>}
      <div className="table-wrap">
        <table className="tbl">
          <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Target</th><th>Details</th></tr></thead>
          <tbody>
            {all.map((e) => (
              <tr key={e.id}>
                <td>{fmtDate(e.at)}</td><td>{e.actor ?? "-"}</td><td>{e.action}</td>
                <td className="mono">{e.targetType ? `${e.targetType}:${e.targetId}` : ""}</td>
                <td className="mono">{e.details ?? ""}</td>
              </tr>
            ))}
            {!all.length && <tr><td colSpan={5} className="muted">Nothing here.</td></tr>}
          </tbody>
        </table>
      </div>
      {all.length >= 100 && all.length % 100 === 0 && <p><button className="btn" onClick={older}>Load older</button></p>}
    </>
  )
}
