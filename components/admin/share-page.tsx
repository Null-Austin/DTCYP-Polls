"use client"

import { useEffect, useRef, useState } from "react"
import PollTabs from "./poll-tabs"
import { api, errMsg } from "@/lib/client/api"
import { useLoad } from "@/lib/client/use-load"

type Share = { userId: number; username: string; permission: "view" | "edit" }
type Data = { access: "view" | "edit" | "owner"; owner: string; shares: Share[] }
type Account = { id: number; label: string; kind: string; level: number; roles: { name: string; color: string }[] }

export default function SharePage({ pollId, selfId }: { pollId: string; selfId: number }) {
  const { data, error, setData } = useLoad<Data>(`/api/admin/polls/${pollId}/shares`)
  const [err, setErr] = useState("")
  const [query, setQuery] = useState("")
  const [suggestions, setSuggestions] = useState<Account[]>([])
  const [active, setActive] = useState(-1)
  const [picked, setPicked] = useState<Account | null>(null)
  const sequence = useRef(0)
  const path = `/api/admin/polls/${pollId}/shares`
  const isOwner = data?.access === "owner"

  useEffect(() => {
    if (!isOwner || !query.trim() || picked) return
    const current = ++sequence.current
    const timer = setTimeout(() => {
      void api<{ accounts: Account[] }>(`/api/admin/polls/${pollId}/shares/search?q=${encodeURIComponent(query.trim())}`)
        .then((result) => { if (sequence.current === current) setSuggestions(result.accounts) })
        .catch((e) => { if (sequence.current === current) setErr(errMsg(e)) })
    }, 180)
    return () => clearTimeout(timer)
  }, [isOwner, pollId, query, picked])

  async function run(fn: () => Promise<{ shares: Share[] }>) {
    try {
      const r = await fn()
      setData((d) => (d ? { ...d, shares: r.shares } : d))
      setErr("")
    } catch (e) {
      setErr(errMsg(e))
    }
  }
  const add = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const form = e.currentTarget
    const f = new FormData(form)
    if (!picked) return setErr("Choose an account from the suggestions")
    void run(async () => {
      const r = await api<{ shares: Share[] }>(path, { method: "POST", body: { username: picked.label, permission: f.get("permission") } })
      form.reset()
      setPicked(null)
      setQuery("")
      return r
    })
  }
  const remove = (userId: number) => run(() => api<{ shares: Share[] }>(path, { method: "DELETE", body: { userId } }))

  return (
    <>
      <h1>Sharing</h1>
      <p className="admin__sub mono">{pollId}</p>
      <PollTabs pollId={pollId} current="share" canLinks={data?.access !== "view"} canResults canShare={isOwner} />
      {(error || err) && <p className="err" role="alert">{error || err}</p>}
      {data && (
        <>
          <p className="muted">
            Owner: <strong>{data.owner}</strong>. <strong>View</strong> lets someone read the poll and its results.
            <strong> Edit</strong> also lets them change it, close it and generate links. Only the owner or an admin can share, trash or permanently delete.
          </p>
          {isOwner && (
            <form className="panel row" onSubmit={add}>
              <label className="field grow">Account
                <input value={picked ? picked.label : query} onChange={(e) => { setPicked(null); setQuery(e.target.value); setSuggestions([]); setActive(-1) }} onKeyDown={(e) => {
                  if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(i + 1, suggestions.length - 1)) }
                  if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)) }
                  if (e.key === "Escape") setSuggestions([])
                  if (e.key === "Enter" && active >= 0 && suggestions[active]) { e.preventDefault(); setPicked(suggestions[active]); setQuery(""); setSuggestions([]) }
                }} role="combobox" aria-autocomplete="list" aria-expanded={suggestions.length > 0} aria-controls="share-account-options" autoComplete="off" placeholder="Search people and bots" />
                {suggestions.length > 0 && <ul id="share-account-options" role="listbox" className="account-options">
                  {suggestions.map((a, i) => <li key={a.id} role="option" aria-selected={i === active} onMouseEnter={() => setActive(i)} onMouseDown={(e) => { e.preventDefault(); setPicked(a); setQuery(""); setSuggestions([]) }}>
                    <span>{a.kind === "bot" && <span className="chip">BOT</span>} {a.label}</span><span className="chips">{a.roles.map((r) => <span className="role-pill" key={r.name} style={{ background: r.color }}>{r.name}</span>)}</span>
                  </li>)}
                </ul>}
              </label>
              <label className="field">Access<select name="permission" defaultValue="view"><option value="view">View</option><option value="edit">Edit</option></select></label>
              <button className="btn btn--primary">Share</button>
            </form>
          )}
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>User</th><th>Access</th><th /></tr></thead>
              <tbody>
                {data.shares.map((s) => (
                  <tr key={s.userId}>
                    <td>{s.username}</td>
                    <td>
                      {isOwner ? (
                        <select aria-label={`Access for ${s.username}`} value={s.permission} style={{ width: 110 }}
                          onChange={(e) => run(() => api<{ shares: Share[] }>(path, { method: "POST", body: { username: s.username, permission: e.target.value } }))}>
                          <option value="view">View</option><option value="edit">Edit</option>
                        </select>
                      ) : s.permission}
                    </td>
                    <td>
                      {(isOwner || s.userId === selfId) && (
                        <button className="btn btn--sm btn--danger" onClick={() => remove(s.userId)}>{s.userId === selfId && !isOwner ? "Leave" : "Remove"}</button>
                      )}
                    </td>
                  </tr>
                ))}
                {!data.shares.length && <tr><td colSpan={3} className="muted">Not shared with anyone.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  )
}
