"use client"

import { useLoad } from "@/lib/client/use-load"
import { api, errMsg, fmtDate } from "@/lib/client/api"
import { useState } from "react"

type Session = { id: number; userId: number; username: string; kind: string; isRoot: number; createdAt: string; expiresAt: string; lastSeenAt: string }
type Data = { failedLoginsLast7Days: number; sessions: Session[]; inactiveAccounts: { username: string; lastLoginAt: string | null }[]; expiringOrUnusedBots: { username: string; expiresAt: string | null; lastUsedAt: string | null }[] }

export default function SecurityPage({ isRoot }: { isRoot: boolean }) {
  const { data, error, reload } = useLoad<Data>("/api/admin/security")
  const [err, setErr] = useState("")
  async function revoke(s: Session) {
    if (!confirm(`Revoke the session for ${s.username}? The session secret is not shown.`)) return
    try { await api(`/api/admin/security/sessions/${s.id}`, { method: "DELETE" }); await reload() }
    catch (e) { setErr(errMsg(e)) }
  }
  return (
    <>
      <h1>Security overview</h1>
      <p className="admin__sub">Session credentials are never displayed; revocation invalidates them server-side.</p>
      {(error || err) && <p className="err" role="alert">{error || err}</p>}
      {data && <div className="stats"><div><small>Failed sign-ins (7 days)</small><strong className="warn">{data.failedLoginsLast7Days}</strong></div><div><small>Active sessions shown</small><strong>{data.sessions.length}</strong></div><div><small>Inactive accounts (90+ days)</small><strong>{data.inactiveAccounts.length}</strong></div><div><small>Expiring or unused bots</small><strong>{data.expiringOrUnusedBots.length}</strong></div></div>}
      <h2>Active sessions</h2>
      <div className="table-wrap"><table className="tbl"><thead><tr><th>Account</th><th>Created</th><th>Last seen</th><th>Expires</th><th /></tr></thead><tbody>
        {data?.sessions.map((s) => <tr key={s.id}><td>{s.kind === "bot" ? `bot:${s.username.slice(4)}` : s.username}{s.isRoot ? <span className="role-pill" style={{ background: "#ed4245", marginLeft: 6 }}>rootadmin</span> : null}</td><td>{fmtDate(s.createdAt)}</td><td>{fmtDate(s.lastSeenAt)}</td><td>{fmtDate(s.expiresAt)}</td><td>{(!s.isRoot || isRoot) && <button className="btn btn--sm btn--danger" onClick={() => void revoke(s)}>Revoke</button>}</td></tr>)}
      </tbody></table></div>
      <h2>Inactive accounts</h2>
      <div className="table-wrap"><table className="tbl"><thead><tr><th>Account</th><th>Last login</th></tr></thead><tbody>{data?.inactiveAccounts.map((u) => <tr key={u.username}><td>{u.username}</td><td>{fmtDate(u.lastLoginAt)}</td></tr>)}</tbody></table></div>
      <h2>Expiring or unused bots</h2>
      <div className="table-wrap"><table className="tbl"><thead><tr><th>Bot</th><th>Expires</th><th>Last used</th></tr></thead><tbody>{data?.expiringOrUnusedBots.map((b) => <tr key={b.username}><td>{b.username}</td><td>{fmtDate(b.expiresAt)}</td><td>{fmtDate(b.lastUsedAt)}</td></tr>)}</tbody></table></div>
    </>
  )
}
