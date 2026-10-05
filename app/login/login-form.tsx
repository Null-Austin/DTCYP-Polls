"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import PollLogo from "@/components/poll/logo"
import { api, errMsg } from "@/lib/client/api"

export default function LoginForm() {
  const router = useRouter()
  const [setup, setSetup] = useState<boolean | null>(null)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api<{ setupRequired: boolean }>("/api/auth/status")
      .then((r) => setSetup(r.setupRequired))
      .catch((e) => setError(errMsg(e)))
  }, [])

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    setBusy(true)
    setError("")
    try {
      if (setup) {
        await api("/api/auth/setup", {
          method: "POST",
          body: { username: f.get("username"), password: f.get("password"), setupToken: f.get("setupToken") || undefined },
        })
      } else {
        await api("/api/auth/login", { method: "POST", body: { username: f.get("username"), password: f.get("password") } })
      }
      router.replace("/admin")
      router.refresh()
    } catch (err) {
      setError(errMsg(err))
      setBusy(false)
    }
  }

  return (
    <main className="pub">
      <header className="pub__head"><PollLogo /></header>
      <section className="pub__card pub__card--narrow">
        <h1>{setup ? "Create admin account" : "Sign in"}</h1>
        {setup && <p className="pf__notice">No accounts exist yet. The first account you create will be the administrator.</p>}
        {setup === null && !error ? (
          <p className="pub__msg">Loading...</p>
        ) : (
          <form className="form" onSubmit={submit}>
            <label>
              Username
              <input name="username" autoComplete="username" required minLength={3} maxLength={32} />
            </label>
            <label>
              Password
              <input name="password" type="password" autoComplete={setup ? "new-password" : "current-password"} required minLength={setup ? 12 : 1} maxLength={256} />
            </label>
            {setup && (
              <>
                <small className="muted">At least 12 characters. No other rules.</small>
                <label>
                  Setup token (only if the server requires one)
                  <input name="setupToken" type="password" autoComplete="off" />
                </label>
              </>
            )}
            {error && <p className="pf__error" role="alert">{error}</p>}
            <button className="btn btn--primary" disabled={busy}>{setup ? "Create account" : "Sign in"}</button>
          </form>
        )}
      </section>
    </main>
  )
}
