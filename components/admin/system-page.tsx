"use client"

import { useLoad } from "@/lib/client/use-load"

type Data = { appVersion: string; node: string; database: { path: string; size: number; walSize: number; shmSize: number; migrationVersion: number }; backups: { count: number }; storage: { path: string; totalBytes: number }; runtime: { uptimeSeconds: number; environment: string } }
const bytes = (n: number) => n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 ** 2).toFixed(1)} MB`

export default function SystemPage() {
  const { data, error } = useLoad<Data>("/api/admin/system")
  return (
    <>
      <h1>System health</h1><p className="admin__sub">Runtime and storage indicators.</p>
      {error && <p className="err">{error}</p>}
      {data && <>
        <div className="stats"><div><small>App version</small><strong>{data.appVersion}</strong></div><div><small>Migration</small><strong>{data.database.migrationVersion}</strong></div><div><small>Runtime</small><strong>{data.runtime.environment}</strong></div><div><small>Uptime</small><strong>{Math.floor(data.runtime.uptimeSeconds / 3600)}h</strong></div></div>
        <section className="panel"><h2 style={{ marginTop: 0 }}>Database</h2><p className="mono">{data.database.path}</p><p>DB {bytes(data.database.size)} · WAL {bytes(data.database.walSize)} · SHM {bytes(data.database.shmSize)}</p><p>{data.backups.count} backup files</p></section>
        <section className="panel"><h2 style={{ marginTop: 0 }}>Runtime</h2><p>Node {data.node}</p><p>Storage volume {bytes(data.storage.totalBytes)} total</p></section>
      </>}
    </>
  )
}
