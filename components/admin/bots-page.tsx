"use client"

import { useState } from "react"
import { api, errMsg, fmtDate } from "@/lib/client/api"
import { useLoad } from "@/lib/client/use-load"

type Bot = { id: number; name: string; username: string; level: number; createdBy: string | null; createdAt: string; expiresAt: string | null; revokedAt: string | null; lastUsedAt: string | null; lastUsedIp: string | null; tokenPrefix: string | null; ipAllowlist: string[]; disabledAt: string | null }
type Role = { id: number; name: string; level: number; isRoot: boolean; color: string }
type Data = { bots: Bot[] }
type RoleData = { roles: Role[]; catalog: { permission: string; description: string }[] }

export default function BotsPage({ canCreate, canRead, canRevoke, canAssign }: { canCreate: boolean; canRead: boolean; canRevoke: boolean; canAssign: boolean }) {
  const { data, error, reload } = useLoad<Data>(canRead ? "/api/admin/bots" : null)
  const { data: roleData } = useLoad<RoleData>(canAssign ? "/api/admin/roles" : null)
  const [err, setErr] = useState("")
  const [token, setToken] = useState("")
  const [expiresAt, setExpiresAt] = useState("")
  const [allowlist, setAllowlist] = useState("")
  const [name, setName] = useState("")
  const [selectedRoles, setSelectedRoles] = useState<number[]>([])

  async function create(e: React.FormEvent) {
    e.preventDefault()
    try {
      const result = await api<{ token: string }>("/api/admin/bots", { method: "POST", body: { name, roleIds: selectedRoles, expiresAt: expiresAt || null, ipAllowlist: allowlist } })
      setToken(result.token)
      setName("")
      setSelectedRoles([])
      await reload()
    } catch (e) { setErr(errMsg(e)) }
  }
  async function revoke(b: Bot) {
    if (!confirm(`Revoke bot:${b.name}? Requests with its current secret will stop working.`)) return
    try { await api(`/api/admin/bots/${b.id}`, { method: "DELETE" }); await reload() }
    catch (e) { setErr(errMsg(e)) }
  }
  async function rotate(b: Bot) {
    if (!confirm(`Rotate bot:${b.name}? Its old secret will stop working immediately.`)) return
    try {
      const r = await api<{ token: string }>(`/api/admin/bots/${b.id}/rotate`, { method: "POST" })
      setToken(r.token)
      await reload()
    } catch (e) { setErr(errMsg(e)) }
  }
  const copy = async () => { await navigator.clipboard.writeText(token); setToken("") }

  return (
    <>
      <h1>API tokens</h1>
      <p className="admin__sub">Tokens authenticate as bot accounts. A token secret is shown once; only its hash is stored.</p>
      {error && <p className="err" role="alert">{error}</p>}
      {err && <p className="err" role="alert">{err}</p>}
      {token && <section className="panel" role="alert"><h2 style={{ marginTop: 0 }}>Copy this token now</h2><p className="mono" style={{ wordBreak: "break-all" }}>{token}</p><div className="row"><button className="btn btn--primary" onClick={() => void copy()}>Copy token</button><button className="btn" onClick={() => setToken("")}>Dismiss</button></div></section>}
      {canCreate && (
        <form className="panel form" onSubmit={create}>
          <h2 style={{ marginTop: 0 }}>Create bot token</h2>
          <label>Bot name<input value={name} onChange={(e) => setName(e.target.value)} pattern="[a-z0-9-]{1,40}" required maxLength={40} placeholder="reporting-bot" /></label>
          <small className="muted">Lowercase letters, digits and dashes, 1-40 characters.</small>
          {canAssign && <fieldset><legend>Roles</legend><div className="chips">{roleData?.roles.filter((r) => !r.isRoot).map((r) => <label key={r.id} className="permission-row"><input type="checkbox" checked={selectedRoles.includes(r.id)} onChange={(e) => setSelectedRoles((s) => e.target.checked ? [...s, r.id] : s.filter((x) => x !== r.id))} /><span className="role-pill" style={{ background: r.color }}>{r.name} · {r.level}</span></label>)}</div></fieldset>}
          <label>Optional expiry<input type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} /></label>
          <label>IP allowlist (optional, one address or CIDR per line)<textarea rows={2} value={allowlist} onChange={(e) => setAllowlist(e.target.value)} /></label>
          <div><button className="btn btn--primary">Create token</button></div>
        </form>
      )}
      {canRead && <div className="table-wrap"><table className="tbl"><thead><tr><th>Bot</th><th>Role level</th><th>Created by</th><th>Created</th><th>Expires</th><th>Last used</th><th>Allowlist</th><th /></tr></thead><tbody>
        {data?.bots.map((b) => <tr key={b.id}><td><span className="chip">BOT</span> <code>{b.username}</code>{b.revokedAt && <span className="chip chip--warn">revoked</span>}</td><td>{b.level}</td><td>{b.createdBy ?? "-"}</td><td>{fmtDate(b.createdAt)}</td><td>{fmtDate(b.expiresAt)}</td><td>{fmtDate(b.lastUsedAt)}</td><td>{b.ipAllowlist.join(", ") || "-"}</td><td><div className="actions">{canRevoke && <><button className="btn btn--sm" onClick={() => void rotate(b)}>Rotate</button>{!b.revokedAt && <button className="btn btn--sm btn--danger" onClick={() => void revoke(b)}>Revoke</button>}</>}</div></td></tr>)}
        {data && !data.bots.length && <tr><td colSpan={8} className="muted">No bot accounts yet.</td></tr>}
      </tbody></table></div>}
    </>
  )
}
