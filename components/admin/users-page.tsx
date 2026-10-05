"use client"

import { useState } from "react"
import { useLoad } from "@/lib/client/use-load"
import { api, errMsg, fmtDate } from "@/lib/client/api"

type U = { id: number; username: string; email: string | null; role: "admin" | "editor"; mustChangePassword: number; disabledAt: string | null; lastLoginAt: string | null }

export default function UsersPage() {
  const { data, error, reload } = useLoad<{ users: U[] }>("/api/admin/users")
  const [err, setErr] = useState("")
  const [temp, setTemp] = useState<{ user: string; pw: string } | null>(null)

  const run = async (fn: () => Promise<unknown>) => {
    try {
      setErr("")
      await fn()
      await reload()
    } catch (e) {
      setErr(errMsg(e))
    }
  }
  const create = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const form = e.currentTarget
    const f = new FormData(form)
    void run(async () => {
      const r = await api<{ temporaryPassword: string }>("/api/admin/users", { method: "POST", body: { username: f.get("username"), email: f.get("email") || undefined, role: f.get("role") } })
      setTemp({ user: String(f.get("username")), pw: r.temporaryPassword })
      form.reset()
    })
  }

  return (
    <>
      <h1>Users</h1>
      <p className="admin__sub">Accounts are created here only. There is no public sign-up.</p>
      {(error || err) && <p className="err" role="alert">{error || err}</p>}
      {temp && (
        <div className="panel" role="status">
          Temporary password for <strong>{temp.user}</strong> (shown once; they must change it at first login):
          <p className="mono" style={{ fontSize: 16 }}>{temp.pw}</p>
          <button className="btn btn--sm" onClick={() => setTemp(null)}>Dismiss</button>
        </div>
      )}
      <form className="panel row" onSubmit={create}>
        <label className="field grow">Username<input name="username" required minLength={3} maxLength={32} autoComplete="off" /></label>
        <label className="field grow">Email (optional)<input name="email" type="email" maxLength={200} autoComplete="off" /></label>
        <label className="field">Role<select name="role" defaultValue="editor"><option value="editor">Editor</option><option value="admin">Admin</option></select></label>
        <button className="btn btn--primary">Create user</button>
      </form>
      <div className="table-wrap">
        <table className="tbl">
          <thead><tr><th>User</th><th>Role</th><th>Status</th><th>Last login</th><th /></tr></thead>
          <tbody>
            {data?.users.map((u) => (
              <tr key={u.id}>
                <td><strong>{u.username}</strong><div className="muted">{u.email}</div></td>
                <td>
                  <select aria-label={`Role for ${u.username}`} value={u.role} style={{ width: 110 }}
                    onChange={(e) => run(() => api(`/api/admin/users/${u.id}`, { method: "PATCH", body: { role: e.target.value } }))}>
                    <option value="editor">Editor</option><option value="admin">Admin</option>
                  </select>
                </td>
                <td>{u.disabledAt ? <span className="chip chip--warn">disabled</span> : u.mustChangePassword ? <span className="chip">temp password</span> : <span className="chip chip--ok">active</span>}</td>
                <td>{fmtDate(u.lastLoginAt)}</td>
                <td>
                  <div className="actions">
                    <button className="btn btn--sm" onClick={() => run(() => api(`/api/admin/users/${u.id}`, { method: "PATCH", body: { disabled: !u.disabledAt } }))}>{u.disabledAt ? "Enable" : "Disable"}</button>
                    <button className="btn btn--sm" onClick={() => confirm(`Reset password for ${u.username}?`) && run(async () => { const r = await api<{ temporaryPassword: string }>(`/api/admin/users/${u.id}/reset-password`, { method: "POST" }); setTemp({ user: u.username, pw: r.temporaryPassword }) })}>Reset password</button>
                    <button className="btn btn--sm btn--danger" onClick={() => confirm(`Delete ${u.username}? Their polls move to you.`) && run(() => api(`/api/admin/users/${u.id}`, { method: "DELETE" }))}>Delete</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
