"use client"

import { useRef, useState } from "react"
import { api, errMsg } from "@/lib/client/api"
import { useLoad } from "@/lib/client/use-load"

type Group = { id: number; name: string; position: number; archivedAt: string | null; urlCount: number; activeCount: number; answeredCount: number | null; repeatCount: number | null }
type Url = { id: number; token: string; title: string; notes: string; enabled: number; groupId: number | null; revokedAt: string | null; verified: number | null; unverified: number | null; url: string }
type GroupData = { groups: Group[] }
type UrlData = { page: number; pageSize: number; total: number; urls: Url[] }

export default function GroupsPanel({ pollId, editable, exportable }: { pollId: string; editable: boolean; exportable: boolean }) {
  const [selectedGroup, setSelectedGroup] = useState<number | null>(null)
  const [query, setQuery] = useState("")
  const [filter, setFilter] = useState("")
  const [page, setPage] = useState(0)
  const [selection, setSelection] = useState<number[]>([])
  const lastClicked = useRef<number | null>(null)
  const [error, setError] = useState("")
  const [toast, setToast] = useState("")
  const [prefix, setPrefix] = useState("")
  const [suffix, setSuffix] = useState("")
  const { data: gd, reload: reloadGroups } = useLoad<GroupData>(`/api/admin/polls/${pollId}/groups`)
  const groups = gd?.groups ?? []
  const active = selectedGroup ?? groups[0]?.id ?? null
  const path = active === null ? null : `/api/admin/polls/${pollId}/groups/${active}/urls?q=${encodeURIComponent(query)}&status=${filter}&page=${page}`
  const { data: ud, error: loadError, reload: reloadUrls } = useLoad<UrlData>(path)
  const urls = ud?.urls ?? []
  const selected = urls.filter((x) => selection.includes(x.id))
  const enabledMixed = new Set(selected.map((x) => !!x.enabled)).size > 1
  const sameGroup = new Set(selected.map((x) => x.groupId ?? "none")).size <= 1
  const flash = (s: string) => { setToast(s); setTimeout(() => setToast(""), 2500) }
  const call = async (fn: () => Promise<unknown>, success?: string) => {
    try { setError(""); await fn(); await Promise.all([reloadGroups(), reloadUrls()]); if (success) flash(success) }
    catch (e) { setError(errMsg(e)) }
  }
  const bulk = (body: Record<string, unknown>) => api(`/api/admin/polls/${pollId}/urls/bulk`, { method: "POST", body: { ids: selection, ...body } })

  async function copy(ids?: number[]) {
    if (active === null) return
    try {
      const r = await api<{ urls: string[] }>(`/api/admin/polls/${pollId}/groups/${active}/urls`, { method: "POST", body: ids?.length ? { ids } : {} })
      await navigator.clipboard.writeText(r.urls.join("\n"))
      flash(`${r.urls.length} URLs copied`)
    } catch (e) { setError(errMsg(e)) }
  }
  function select(row: Url, event: React.MouseEvent<HTMLInputElement>) {
    if (event.shiftKey && lastClicked.current !== null) {
      const a = urls.findIndex((x) => x.id === lastClicked.current)
      const b = urls.findIndex((x) => x.id === row.id)
      const range = urls.slice(Math.min(a, b), Math.max(a, b) + 1).map((x) => x.id)
      setSelection((s) => [...new Set([...s, ...range])])
    } else setSelection((s) => s.includes(row.id) ? s.filter((x) => x !== row.id) : [...s, row.id])
    lastClicked.current = row.id
  }
  async function patchUrl(row: Url, body: Record<string, unknown>) {
    await api(`/api/admin/polls/${pollId}/urls/${row.id}`, { method: "PATCH", body })
    await reloadUrls()
  }
  async function createGroup(duplicateFrom?: number) {
    const name = prompt(duplicateFrom === undefined ? "Group name" : "Name for the duplicate group", "")
    if (name === null) return
    await call(() => api(`/api/admin/polls/${pollId}/groups`, { method: "POST", body: { name, duplicateFrom } }), "Group created")
  }

  return (
    <section className="panel">
      <div className="row"><h2 className="grow" style={{ marginTop: 0 }}>Distribution groups</h2>
        {editable && <button className="btn btn--sm btn--primary" onClick={() => void createGroup()}>New group</button>}
      </div>
      {(error || loadError) && <p className="err" role="alert">{error || loadError}</p>}
      {toast && <div className="toast" role="status">{toast}</div>}
      <div className="table-wrap" style={{ marginBottom: 16 }}>
        <table className="tbl">
          <thead><tr><th>Group</th><th>URLs</th><th>Answered</th><th>Repeats</th><th>Actions</th></tr></thead>
          <tbody>
            {groups.map((g) => (
              <tr key={g.id} className={active === g.id ? "is-sel" : ""} onClick={() => { setSelectedGroup(g.id); setSelection([]); setPage(0) }}>
                <td><strong>{g.name || "Untitled group"}</strong>{g.archivedAt && <span className="chip">archived</span>}</td>
                <td>{g.activeCount}/{g.urlCount} active</td><td>{g.answeredCount ?? "-"}</td><td>{g.repeatCount ?? "-"}</td>
                <td><div className="actions">
                  {exportable && <button className="btn btn--sm" onClick={(e) => { e.stopPropagation(); void copy() }}>Copy all</button>}
                  {editable && <>
                    <button className="btn btn--sm" onClick={(e) => { e.stopPropagation(); const name = prompt("Rename group", g.name); if (name !== null) void call(() => api(`/api/admin/polls/${pollId}/groups`, { method: "PATCH", body: { id: g.id, name } })) }}>Rename</button>
                    <button className="btn btn--sm" onClick={(e) => { e.stopPropagation(); void createGroup(g.id) }}>Duplicate</button>
                    <button className="btn btn--sm" onClick={(e) => { e.stopPropagation(); void call(() => api(`/api/admin/polls/${pollId}/groups`, { method: "PATCH", body: { id: g.id, archived: !g.archivedAt } })) }}>{g.archivedAt ? "Unarchive" : "Archive"}</button>
                  </>}
                </div></td>
              </tr>
            ))}
            {!groups.length && <tr><td colSpan={5} className="muted">Generate URLs to create your first group.</td></tr>}
          </tbody>
        </table>
      </div>

      {active !== null && (
        <>
          <div className="row" style={{ marginBottom: 12 }}>
            <input aria-label="Search URLs" value={query} placeholder="Search title or token" onChange={(e) => { setQuery(e.target.value); setPage(0) }} style={{ maxWidth: 280 }} />
            <select aria-label="URL status" value={filter} onChange={(e) => { setFilter(e.target.value); setPage(0) }} style={{ width: 140 }}><option value="">All</option><option value="enabled">Enabled</option><option value="disabled">Disabled</option></select>
            {exportable && <button className="btn btn--sm" onClick={() => void copy(selection.length ? selection : undefined)}>Copy {selection.length ? `selected (${selection.length})` : "group"}</button>}
          </div>
          {selection.length > 0 && editable && (
            <div className="row panel">
              <strong>{selection.length} selected</strong>
              <button className="btn btn--sm" onClick={() => setSelection(urls.map((u) => u.id))}>Select page</button>
              <button className="btn btn--sm" onClick={() => setSelection([])}>Clear</button>
              <button className="btn btn--sm" onClick={() => setSelection(urls.filter((u) => !selection.includes(u.id)).map((u) => u.id))}>Invert page</button>
              <select aria-label="Bulk enabled state" value={enabledMixed ? "mixed" : selected[0]?.enabled ? "enabled" : "disabled"} onChange={(e) => e.target.value !== "mixed" && void call(() => bulk({ enabled: e.target.value === "enabled" }))}>
                {enabledMixed && <option value="mixed">Mixed</option>}<option value="enabled">Enabled</option><option value="disabled">Disabled</option>
              </select>
              <select aria-label="Move selected to group" value={sameGroup ? String(selected[0]?.groupId ?? "none") : "mixed"} onChange={(e) => e.target.value !== "mixed" && void call(() => bulk({ groupId: e.target.value === "none" ? null : Number(e.target.value) }))}>
                <option value="mixed">Mixed</option><option value="none">No group</option>{groups.map((g) => <option key={g.id} value={g.id}>{g.name || "Untitled group"}</option>)}
              </select>
              <input aria-label="Bulk title prefix" value={prefix} placeholder="Prefix" onChange={(e) => setPrefix(e.target.value)} style={{ width: 120 }} />
              <input aria-label="Bulk title suffix" value={suffix} placeholder="Suffix" onChange={(e) => setSuffix(e.target.value)} style={{ width: 120 }} />
              <button className="btn btn--sm" disabled={!prefix && !suffix} onClick={() => void call(() => bulk({ prefix, suffix }))}>Rename</button>
              <button className="btn btn--sm btn--danger" onClick={() => void call(() => bulk({ enabled: false }))}>Disable</button>
              <button className="btn btn--sm btn--danger" onClick={() => confirm(`Delete ${selection.length} selected URL(s)? URLs with responses will be retained.`) && void call(() => bulk({ delete: true }))}>Delete</button>
            </div>
          )}
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th><input type="checkbox" aria-label="Select all on page" checked={urls.length > 0 && urls.every((x) => selection.includes(x.id))} onChange={(e) => setSelection(e.target.checked ? [...new Set([...selection, ...urls.map((x) => x.id)])] : selection.filter((id) => !urls.some((x) => x.id === id)))} /></th><th>Title</th><th>URL</th><th>Status</th><th>Answers</th><th>Notes</th><th>Actions</th></tr></thead>
              <tbody>
                {urls.map((u) => (
                  <tr key={u.id}>
                    <td><input type="checkbox" aria-label={`Select URL ${u.id}`} checked={selection.includes(u.id)} onClick={(e) => select(u, e)} onChange={() => {}} /></td>
                    <td>{editable ? <input aria-label="URL title" defaultValue={u.title} key={`${u.id}-${u.title}`} maxLength={200} onBlur={(e) => e.target.value !== u.title && void call(() => patchUrl(u, { title: e.target.value }))} /> : u.title || "(untitled)"}</td>
                    <td className="mono"><a href={u.url} target="_blank" rel="noreferrer">{u.url.slice(0, 42)}…</a></td>
                    <td>{u.revokedAt || !u.enabled ? <span className="chip chip--warn">disabled</span> : <span className="chip chip--ok">enabled</span>}</td>
                    <td>{u.verified === null ? "-" : <><span className="ok">{u.verified}</span> / <span className="warn">{u.unverified}</span></>}</td>
                    <td>{editable ? <input aria-label="URL notes" defaultValue={u.notes} key={`n${u.id}-${u.notes}`} maxLength={2000} onBlur={(e) => e.target.value !== u.notes && void call(() => patchUrl(u, { notes: e.target.value }))} /> : u.notes}</td>
                    <td><div className="actions">
                      {exportable && <button className="btn btn--sm" onClick={() => navigator.clipboard.writeText(u.url).then(() => flash("URL copied"))}>Copy</button>}
                      {editable && <>
                        <button className="btn btn--sm" onClick={() => void call(() => patchUrl(u, { enabled: !u.enabled }))}>{u.enabled ? "Disable" : "Enable"}</button>
                        <button className="btn btn--sm" onClick={() => confirm("Generate a replacement URL? The current URL will stop working.") && void call(async () => { const r = await api<{ url: string }>(`/api/admin/polls/${pollId}/urls/${u.id}/regenerate`, { method: "POST" }); await navigator.clipboard.writeText(r.url) }, "Replacement copied")}>Regenerate</button>
                        <button className="btn btn--sm btn--danger" onClick={() => confirm("Delete this URL? Responses prevent deletion.") && void call(() => api(`/api/admin/polls/${pollId}/urls/${u.id}`, { method: "DELETE" }))}>Delete</button>
                      </>}
                    </div></td>
                  </tr>
                ))}
                {!urls.length && <tr><td colSpan={7} className="muted">No URLs in this group.</td></tr>}
              </tbody>
            </table>
          </div>
          {ud && <div className="row row--end" style={{ marginTop: 12 }}><span className="muted">{ud.total} URLs · page {page + 1}</span><button className="btn btn--sm" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button><button className="btn btn--sm" disabled={(page + 1) * ud.pageSize >= ud.total} onClick={() => setPage(page + 1)}>Next</button></div>}
        </>
      )}
    </section>
  )
}
