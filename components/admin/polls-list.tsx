"use client"

import Link from "next/link"
import { useState } from "react"
import { useRouter } from "next/navigation"
import { useLoad } from "@/lib/client/use-load"
import { api, errMsg, fmtDate, FULL_WARNING } from "@/lib/client/api"
import { showAlert } from "@/lib/alerts"

type Row = { id: string; title: string; status: string; owner_id: number; owner: string; access: "view" | "edit" | "owner"; created_at: string; archived_at: string | null; deleted_at: string | null; responses: number | null; last_response: string | null }
type User = { id: number; username: string }

export default function PollsList({ permissions, isRoot }: { permissions: string[]; isRoot: boolean }) {
  const can = (p: string) => isRoot || permissions.includes(p)
  const canEdit = (access: Row["access"]) => access === "owner" || access === "edit"

  const router = useRouter()
  const [q, setQ] = useState("")
  const [status, setStatus] = useState("")
  const [owner, setOwner] = useState("")
  const [sort, setSort] = useState("created")
  const [dir, setDir] = useState<"asc" | "desc">("desc")
  const [sel, setSel] = useState<string[]>([])
  const [err, setErr] = useState("")
  const qs = new URLSearchParams({ q, status, owner, sort, dir }).toString()
  const { data, error, reload } = useLoad<{ polls: Row[] }>(`/api/admin/polls?${qs}`)
  const users = useLoad<{ users: User[] }>(can("users:read") ? "/api/admin/users" : null)

  async function act(id: string, action: string) {
    try {
      await api(`/api/admin/polls/${id}/action`, { method: "POST", body: { action } })
      await reload()
    } catch (e) {
      setErr(errMsg(e))
    }
  }
  async function bulk(action: string) {
    if (!confirm(`${action} ${sel.length} poll(s)?`)) return
    try {
      await api("/api/admin/polls/bulk", { method: "POST", body: { ids: sel, action } })
      setSel([])
      await reload()
    } catch (e) {
      setErr(errMsg(e))
    }
  }
  async function dup(id: string) {
    const newId = prompt("Id for the copy (lowercase letters, numbers, hyphens)", `${id}-copy`)
    if (!newId) return
    try {
      await api(`/api/admin/polls/${id}/action`, { method: "POST", body: { action: "duplicate", newId } })
      showAlert({ title: "Duplicated", message: "Questions and options were copied.", tone: "success" })
      await reload()
    } catch (e) {
      setErr(errMsg(e))
    }
  }
  async function destroy(id: string) {
    if (prompt(`This permanently deletes the poll, its links and all responses.\nType "${id}" to confirm.`) !== id) return
    try {
      await api(`/api/admin/polls/${id}`, { method: "DELETE", body: { confirm: id } })
      await reload()
    } catch (e) {
      setErr(errMsg(e))
    }
  }
  async function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    try {
      await api("/api/admin/polls", { method: "POST", body: { id: f.get("id"), title: f.get("title") } })
      router.push(`/admin/${f.get("id")}/edit`)
    } catch (e2) {
      setErr(errMsg(e2))
    }
  }
  const th = (key: string, label: string) => (
    <th aria-sort={sort === key ? (dir === "asc" ? "ascending" : "descending") : "none"}>
      <button onClick={() => (sort === key ? setDir(dir === "asc" ? "desc" : "asc") : (setSort(key), setDir("desc")))}>{label}{sort === key ? (dir === "asc" ? " ▲" : " ▼") : ""}</button>
    </th>
  )
  const rows = data?.polls ?? []
  const trash = status === "trash"

  return (
    <>
      <h1>Polls</h1>
      <p className="admin__sub">Create, schedule and manage polls.</p>
      {can("polls:create") && <form className="panel row" onSubmit={create}>
        <label className="field grow">Title<input name="title" required maxLength={200} placeholder="Team lunch vote" /></label>
        <label className="field grow">Poll id (permanent)<input name="id" required pattern="[a-z0-9][a-z0-9\-]{1,59}" placeholder="lunch-vote" /></label>
        <button className="btn btn--primary">Create poll</button>
      </form>}
      <div className="row" style={{ marginBottom: 12 }}>
        <input className="grow" aria-label="Search polls" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
        <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: 140 }}>
          <option value="">Active</option>
          {["draft", "open", "closed", "archived", "trash"].map((s) => <option key={s}>{s}</option>)}
        </select>
        {isRoot && (
          <select aria-label="Owner" value={owner} onChange={(e) => setOwner(e.target.value)} style={{ width: 160 }}>
            <option value="">All owners</option>
            {users.data?.users.map((u) => <option key={u.id} value={u.id}>{u.username}</option>)}
          </select>
        )}
        {can("admin:export") && (
          <>
            <a className="btn" href="/api/admin/export?format=zip" onClick={(e) => { if (!confirm(FULL_WARNING)) e.preventDefault() }}>Export everything (ZIP)</a>
          </>
        )}
      </div>
      {(error || err) && <p className="err" role="alert">{error || err}</p>}
      {sel.length > 0 && can("polls:publish") && <button className="btn btn--sm" onClick={() => bulk("close")}>Close</button>}
      {sel.length > 0 && can("polls:publish") && <button className="btn btn--sm" onClick={() => bulk("archive")}>Archive</button>}
      {sel.length > 0 && can("polls:publish") && <button className="btn btn--sm btn--danger" onClick={() => bulk("trash")}>Move to trash</button>}
      <div className="table-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th><input type="checkbox" aria-label="Select all" checked={rows.length > 0 && sel.length === rows.length} onChange={(e) => setSel(e.target.checked ? rows.map((r) => r.id) : [])} /></th>
              {th("title", "Poll")}<th>Status</th>{isRoot && <th>Owner</th>}{th("created", "Created")}{th("responses", "Responses")}{th("last_response", "Last response")}<th />
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} className={sel.includes(p.id) ? "is-sel" : ""}>
                <td><input type="checkbox" aria-label={`Select ${p.title}`} checked={sel.includes(p.id)} onChange={(e) => setSel(e.target.checked ? [...sel, p.id] : sel.filter((x) => x !== p.id))} /></td>
                <td><strong>{p.title}</strong><div className="mono muted">{p.id}{p.access !== "owner" && ` · shared by ${p.owner} (${p.access})`}</div></td>
                <td><span className="chip">{p.deleted_at ? "trash" : p.archived_at ? "archived" : p.status}</span></td>
                {isRoot && <td>{p.owner}</td>}
                <td>{fmtDate(p.created_at)}</td>
                <td>{p.responses ?? "-"}</td>
                <td>{fmtDate(p.last_response)}</td>
                <td>
                  <div className="actions">
                    {trash ? (
                      canEdit(p.access) ? <>
                        <button className="btn btn--sm" onClick={() => act(p.id, "restore")}>Restore</button>
                        <button className="btn btn--sm btn--danger" onClick={() => destroy(p.id)}>Delete permanently</button>
                      </> : <span className="muted">View only</span>
                    ) : (
                      <>
                        <Link className="btn btn--sm" href={`/admin/${p.id}/edit`}>{p.access === "view" ? "View" : "Edit"}</Link>
                        {p.access !== "view" && <Link className="btn btn--sm" href={`/admin/${p.id}/links`}>Links</Link>}
                        <Link className="btn btn--sm" href={`/admin/${p.id}/results`}>Results</Link>
                        {p.access === "owner" && <Link className="btn btn--sm" href={`/admin/${p.id}/share`}>Share</Link>}
                        {can("polls:create") && <button className="btn btn--sm" onClick={() => dup(p.id)}>Duplicate</button>}
                        {canEdit(p.access) && (p.status === "open" ? <button className="btn btn--sm" onClick={() => act(p.id, "close")}>Close</button> : <button className="btn btn--sm" onClick={() => act(p.id, "reopen")}>Reopen</button>)}
                        {canEdit(p.access) && (p.archived_at ? <button className="btn btn--sm" onClick={() => act(p.id, "unarchive")}>Unarchive</button> : <button className="btn btn--sm" onClick={() => act(p.id, "archive")}>Archive</button>)}
                        {p.access === "owner" && <button className="btn btn--sm btn--danger" onClick={() => act(p.id, "trash")}>Trash</button>}
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={8} className="muted">No polls here.</td></tr>}
          </tbody>
        </table>
      </div>
      {trash && <p className="muted">Trashed polls are deleted for good after 30 days.</p>}
    </>
  )
}
