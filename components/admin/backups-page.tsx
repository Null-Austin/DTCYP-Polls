"use client"

import { useState } from "react"
import { api, errMsg, fmtDate } from "@/lib/client/api"
import { useLoad } from "@/lib/client/use-load"

type B = { name: string; size: number; createdAt: string; sha256: string }

export default function BackupsPage() {
  const { data, error, reload } = useLoad<{ backups: B[] }>("/api/admin/backups")
  const [err, setErr] = useState("")
  const [busy, setBusy] = useState(false)
  async function create() {
    setBusy(true)
    setErr("")
    try { await api("/api/admin/backups", { method: "POST" }); await reload() }
    catch (e) { setErr(errMsg(e)) }
    finally { setBusy(false) }
  }
  async function remove(b: B) {
    if (!confirm(`Permanently delete backup ${b.name}?`)) return
    try { await api(`/api/admin/backups/${encodeURIComponent(b.name)}`, { method: "DELETE" }); await reload() }
    catch (e) { setErr(errMsg(e)) }
  }
  return (
    <>
      <h1>Backups</h1>
      <p className="admin__sub">Database snapshots include poll answers and link tokens. Store downloaded backups securely. Restoring from this page is not enabled yet.</p>
      <div className="row" style={{ marginBottom: 16 }}>
        <button className="btn btn--primary" disabled={busy} onClick={() => void create()}>Create backup now</button>
      </div>
      {(error || err) && <p className="err" role="alert">{error || err}</p>}
      <div className="table-wrap">
        <table className="tbl">
          <thead><tr><th>Created</th><th>File</th><th>Size</th><th>SHA-256</th><th /></tr></thead>
          <tbody>
            {data?.backups.map((b) => (
              <tr key={b.name}>
                <td>{fmtDate(b.createdAt)}</td><td className="mono">{b.name}</td><td>{(b.size / 1024 / 1024).toFixed(2)} MB</td>
                <td className="mono">{b.sha256}</td>
                <td><div className="actions"><a className="btn btn--sm" href={`/api/admin/backups/${encodeURIComponent(b.name)}`}>Download</a><button className="btn btn--sm btn--danger" onClick={() => void remove(b)}>Delete</button></div></td>
              </tr>
            ))}
            {data && !data.backups.length && <tr><td colSpan={5} className="muted">No manual backups yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  )
}
