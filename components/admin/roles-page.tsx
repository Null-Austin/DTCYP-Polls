"use client"

import { useState } from "react"
import { useLoad } from "@/lib/client/use-load"
import { api, errMsg } from "@/lib/client/api"

type Catalog = { permission: string; description: string }
type Grant = { permission: string; scope: string }
type Role = { id: number; name: string; color: string; level: number; position: number; isRoot: boolean; createdAt: string; users: number; permissionCount: number; permissions: Grant[] }
type Data = { roles: Role[]; catalog: Catalog[] }
type Draft = { name: string; color: string; level: number; position: number; permissions: Grant[] }

export default function RolesPage({ actor }: { actor: { isRoot: boolean; level: number; permissions: string[]; grants: Grant[] } }) {
  const { data, error, reload } = useLoad<Data>("/api/admin/roles")
  const [selected, setSelected] = useState<number | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [err, setErr] = useState("")
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState("")
  const can = (p: string) => actor.isRoot || actor.grants.some((g) => g.permission === p)
  const canScope = (p: string, scope: string) => actor.isRoot || actor.grants.some((g) => g.permission === p && (!g.scope || g.scope === scope))
  const groups = (data?.catalog ?? []).reduce<Record<string, Catalog[]>>((out, entry) => {
    const group = entry.permission.split(":")[0]
    ;(out[group] ??= []).push(entry)
    return out
  }, {})
  const role = data?.roles.find((r) => r.id === selected)

  function edit(r: Role) {
    setSelected(r.id)
    setDraft({ name: r.name, color: r.color, level: r.level, position: r.position, permissions: r.permissions })
  }

  async function save() {
    if (!draft) return
    setBusy(true)
    setErr("")
    try {
      if (selected === null) await api("/api/admin/roles", { method: "POST", body: draft })
      else await api(`/api/admin/roles/${selected}`, { method: "PATCH", body: draft })
      setToast("Role saved")
      setTimeout(() => setToast(""), 2500)
      setSelected(null)
      setDraft(null)
      await reload()
    } catch (e) {
      setErr(errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  async function remove(r: Role) {
    if (!confirm(`Delete role "${r.name}"? It must first be removed from every account.`)) return
    try {
      await api(`/api/admin/roles/${r.id}`, { method: "DELETE" })
      setSelected(null)
      setDraft(null)
      await reload()
    } catch (e) {
      setErr(errMsg(e))
    }
  }

  function toggle(p: string) {
    if (!draft) return
    const exists = draft.permissions.some((x) => x.permission === p)
    setDraft({ ...draft, permissions: exists ? draft.permissions.filter((x) => x.permission !== p) : [...draft.permissions, { permission: p, scope: "" }] })
  }

  function setPermissionScope(p: string, scope: string) {
    if (!draft) return
    setDraft({ ...draft, permissions: draft.permissions.map((g) => g.permission === p ? { ...g, scope } : g) })
  }

  return (
    <>
      <h1>Roles</h1>
      <p className="admin__sub">Roles combine permissions and a hierarchy level. Higher levels can administer lower levels only.</p>
      {(error || err) && <p className="err" role="alert">{error || err}</p>}
      {toast && <div className="toast" role="status">{toast}</div>}
      <div className="row" style={{ alignItems: "flex-start" }}>
        <section className="panel" style={{ width: 280, flex: "0 0 280px" }}>
          <div className="row"><h2 className="grow" style={{ marginTop: 0 }}>Role list</h2>
            {can("role:create") && <button className="btn btn--primary btn--sm" onClick={() => { setSelected(null); setDraft({ name: "", color: "#5b8def", level: Math.max(0, Math.min(actor.level - 1, 10)), position: data?.roles.length ?? 0, permissions: [] }) }}>New</button>}
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            {data?.roles.map((r) => (
              <button key={r.id} className="btn" style={{ justifyContent: "space-between", borderColor: selected === r.id ? "var(--primary)" : undefined }} onClick={() => edit(r)}>
                <span className="role-pill" style={{ background: r.color }}>{r.name}</span>
                <small className="muted">{r.level}{r.isRoot ? " · protected" : ""}</small>
              </button>
            ))}
          </div>
        </section>

        {draft && (
          <section className="panel grow" style={{ minWidth: 300 }}>
            <h2 style={{ marginTop: 0 }}>{selected === null ? "Create role" : role?.isRoot ? "Rootadmin role" : `Edit ${role?.name ?? "role"}`}</h2>
            {role?.isRoot ? <p className="pf__notice">rootadmin is immutable: level 255, all permissions.</p> : (
              <>
                <div className="row">
                  <label className="field grow">Name<input value={draft.name} maxLength={50} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
                  <label className="field">Color<input type="color" value={draft.color} onChange={(e) => setDraft({ ...draft, color: e.target.value })} /></label>
                  <label className="field">Level<input type="number" min={0} max={actor.isRoot ? 254 : Math.max(0, actor.level - 1)} value={draft.level} onChange={(e) => setDraft({ ...draft, level: Number(e.target.value) })} /></label>
                  <label className="field">Position<input type="number" min={0} value={draft.position} onChange={(e) => setDraft({ ...draft, position: Number(e.target.value) })} /></label>
                </div>
                <p>Preview: <span className="role-pill" style={{ background: draft.color }}>{draft.name || "Role name"}</span></p>
                <div className="permission-groups">
                  {Object.entries(groups).map(([group, values]) => (
                    <fieldset className="permission-group" key={group}>
                      <legend><h3>{group}</h3></legend>
                      {values.map(({ permission, description }) => (
                        <label className="permission-row" key={permission} title={description}>
                          <input type="checkbox" checked={draft.permissions.some((g) => g.permission === permission)} disabled={!can(permission)} onChange={() => toggle(permission)} />
                          <span className="grow"><code>{permission}</code><br /><small className="muted">{description}</small></span>
                          {draft.permissions.some((g) => g.permission === permission) && (
                            <select aria-label={`Scope for ${permission}`} value={draft.permissions.find((g) => g.permission === permission)?.scope ?? ""}
                              onChange={(e) => setPermissionScope(permission, e.target.value)} style={{ width: 90 }}>
                              {["", "own"].filter((scope) => canScope(permission, scope)).map((scope) => <option key={scope} value={scope}>{scope || "global"}</option>)}
                            </select>
                          )}
                        </label>
                      ))}
                    </fieldset>
                  ))}
                </div>
                <div className="row" style={{ marginTop: 16 }}>
                  <button className="btn btn--primary" disabled={busy || (!can("role:create") && selected === null) || (!can("role:edit") && selected !== null)} onClick={save}>Save role</button>
                  {selected !== null && can("role:delete") && <button className="btn btn--danger" disabled={!!role?.users} onClick={() => role && void remove(role)}>Delete</button>}
                  <button className="btn" onClick={() => { setDraft(null); setSelected(null) }}>Cancel</button>
                </div>
              </>
            )}
          </section>
        )}
      </div>
    </>
  )
}
