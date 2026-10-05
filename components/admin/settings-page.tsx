"use client"

import { useEffect, useState } from "react"
import { useLoad } from "@/lib/client/use-load"
import { api, errMsg } from "@/lib/client/api"
import { showAlert } from "@/lib/alerts"

type S = { retentionDays: number; idleMinutes: number; maxHours: number; publicBaseUrl: string; publicBaseUrlFromEnv: boolean }

export default function SettingsPage() {
  const { data, error, reload } = useLoad<S>("/api/admin/settings")
  const [s, setS] = useState<S | null>(null)
  const [err, setErr] = useState("")
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync fetched settings into the form
    if (data) setS(data)
  }, [data])
  if (!s) return <p className="muted">{error || "Loading..."}</p>

  async function save(e: React.FormEvent) {
    e.preventDefault()
    try {
      const body: Partial<S> = { retentionDays: s!.retentionDays, idleMinutes: s!.idleMinutes, maxHours: s!.maxHours }
      if (!s!.publicBaseUrlFromEnv) body.publicBaseUrl = s!.publicBaseUrl
      await api("/api/admin/settings", { method: "PATCH", body })
      setErr("")
      showAlert({ title: "Saved", message: "Settings updated.", tone: "success" })
      await reload()
    } catch (e2) {
      setErr(errMsg(e2))
    }
  }
  const num = (k: "retentionDays" | "idleMinutes" | "maxHours") => (e: React.ChangeEvent<HTMLInputElement>) => setS({ ...s!, [k]: Number(e.target.value) })

  return (
    <>
      <h1>Settings</h1>
      <p className="admin__sub">Retention, sessions and public links.</p>
      <form className="panel form" style={{ maxWidth: 480 }} onSubmit={save}>
        <label>Delete responses after (days)<input type="number" min={1} max={3650} value={s.retentionDays} onChange={num("retentionDays")} /></label>
        <label>Session idle timeout (minutes)<input type="number" min={5} max={1440} value={s.idleMinutes} onChange={num("idleMinutes")} /></label>
        <label>Session maximum length (hours)<input type="number" min={1} max={720} value={s.maxHours} onChange={num("maxHours")} /></label>
        <label>
          Public base URL
          <input value={s.publicBaseUrl} readOnly={s.publicBaseUrlFromEnv} placeholder="https://polls.example.org" onChange={(e) => setS({ ...s, publicBaseUrl: e.target.value })} />
        </label>
        {s.publicBaseUrlFromEnv && <small className="muted">Set by the PUBLIC_BASE_URL environment variable.</small>}
        {err && <p className="err" role="alert">{err}</p>}
        <div><button className="btn btn--primary">Save</button></div>
      </form>
    </>
  )
}
