"use client"

import { useState } from "react"
import PollTabs from "./poll-tabs"
import { api, errMsg } from "@/lib/client/api"
import { useLoad } from "@/lib/client/use-load"

type Share = { userId: number; username: string; permission: "view" | "edit" }
type Data = { access: "view" | "edit" | "owner"; owner: string; shares: Share[] }

export default function SharePage({ pollId, selfId }: { pollId: string; selfId: number }) {
  const { data, error, setData } = useLoad<Data>(`/api/admin/polls/${pollId}/shares`)
  const [err, setErr] = useState("")
  const path = `/api/admin/polls/${pollId}/shares`
  const isOwner = data?.access === "owner"

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
    void run(async () => {
      const r = await api<{ shares: Share[] }>(path, { method: "POST", body: { username: f.get("username"), permission: f.get("permission") } })
      form.reset()
      return r
    })
  }
  const remove = (userId: number) => run(() => api<{ shares: Share[] }>(path, { method: "DELETE", body: { userId } }))

  return (
    <>
      <h1>Sharing</h1>
      <p className="admin__sub mono">{pollId}</p>
      <PollTabs pollId={pollId} current="share" />
      {(error || err) && <p className="err" role="alert">{error || err}</p>}
      {data && (
        <>
          <p className="muted">
            Owner: <strong>{data.owner}</strong>. <strong>View</strong> lets someone read the poll and its results.
            <strong> Edit</strong> also lets them change it, close it and generate links. Only the owner or an admin can share, trash or permanently delete.
          </p>
          {isOwner && (
            <form className="panel row" onSubmit={add}>
              <label className="field grow">Username<input name="username" required maxLength={32} autoComplete="off" /></label>
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
