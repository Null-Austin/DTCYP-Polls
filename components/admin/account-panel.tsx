"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { api, errMsg } from "@/lib/client/api"
import { showAlert } from "@/lib/alerts"

export default function AccountPanel({ forced }: { forced?: boolean }) {
  const router = useRouter()
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  async function change(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const f = new FormData(form)
    if (f.get("next") !== f.get("again")) return setError("New passwords do not match")
    setBusy(true)
    try {
      await api("/api/auth/password", { method: "POST", body: { current: f.get("current"), next: f.get("next") } })
      showAlert({ title: "Password changed", message: "Other sessions were signed out.", tone: "success" })
      form.reset()
      setError("")
      if (forced) router.refresh()
    } catch (err) {
      setError(errMsg(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <section className="panel" style={{ maxWidth: 440 }}>
        <h2 style={{ marginTop: 0 }}>Change password</h2>
        <form className="form" onSubmit={change}>
          <label>Current password<input name="current" type="password" autoComplete="current-password" required /></label>
          <label>New password<input name="next" type="password" autoComplete="new-password" required minLength={12} maxLength={256} /></label>
          <label>Repeat new password<input name="again" type="password" autoComplete="new-password" required minLength={12} /></label>
          <small className="muted">At least 12 characters. Very common passwords are refused.</small>
          {error && <p className="err" role="alert">{error}</p>}
          <button className="btn btn--primary" disabled={busy}>Change password</button>
        </form>
      </section>
      {!forced && (
        <section className="panel" style={{ maxWidth: 440 }}>
          <h2 style={{ marginTop: 0 }}>Sessions</h2>
          <button
            className="btn"
            onClick={async () => {
              await api("/api/auth/logout?all=1", { method: "POST" }).catch(() => {})
              router.replace("/login")
              router.refresh()
            }}
          >
            Log out everywhere
          </button>
        </section>
      )}
    </>
  )
}
