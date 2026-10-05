"use client"

import Link from "next/link"
import { useLoad } from "@/lib/client/use-load"
import { fmtDate } from "@/lib/client/api"

type D = {
  counts: { openPolls: number; links: number; verified: number; repeats: number }
  recent: { id: string; title: string; status: string; lastResponse: string | null; responses: number }[]
  activity: { id: number; at: string; action: string; targetType: string | null; targetId: string | null }[]
}

export default function Dashboard() {
  const { data, error } = useLoad<D>("/api/admin/dashboard")
  return (
    <>
      <h1>Dashboard</h1>
      <p className="admin__sub">What is happening across your polls.</p>
      {error && <p className="err">{error}</p>}
      {data && (
        <>
          <div className="stats">
            <div><small>Open polls</small><strong>{data.counts.openPolls}</strong></div>
            <div><small>Links generated</small><strong>{data.counts.links}</strong></div>
            <div><small>Verified answers</small><strong className="ok">{data.counts.verified}</strong></div>
            <div><small>Repeat answers</small><strong className="warn">{data.counts.repeats}</strong></div>
          </div>
          <h2>Recently active polls</h2>
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>Poll</th><th>Status</th><th>Responses</th><th>Last response</th></tr></thead>
              <tbody>
                {data.recent.map((p) => (
                  <tr key={p.id}>
                    <td><Link href={`/admin/${p.id}/results`}>{p.title}</Link></td>
                    <td>{p.status}</td>
                    <td>{p.responses}</td>
                    <td>{fmtDate(p.lastResponse)}</td>
                  </tr>
                ))}
                {!data.recent.length && <tr><td colSpan={4} className="muted">No polls yet. Create one under Polls.</td></tr>}
              </tbody>
            </table>
          </div>
          <h2>Recent activity</h2>
          <div className="table-wrap">
            <table className="tbl">
              <tbody>
                {data.activity.map((a) => (
                  <tr key={a.id}>
                    <td>{fmtDate(a.at)}</td>
                    <td>{a.action}</td>
                    <td className="mono">{a.targetId ?? ""}</td>
                  </tr>
                ))}
                {!data.activity.length && <tr><td className="muted">Nothing yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  )
}
