import { route } from "@/lib/server/authz"
import { exact, HttpError, intIn, json, readJson, str } from "@/lib/server/http"
import { audit, getSetting, setSetting } from "@/lib/server/audit"
import { env } from "@/lib/server/env"
import { timeouts } from "@/lib/server/auth"

function view(db: Parameters<typeof timeouts>[0]) {
  const t = timeouts(db)
  return {
    retentionDays: Number(getSetting(db, "retention_days")) || env.retentionDays(),
    idleMinutes: t.idleMs / 60_000,
    maxHours: t.maxMs / 3_600_000,
    publicBaseUrl: env.publicBaseUrl() || getSetting(db, "public_base_url") || "",
    publicBaseUrlFromEnv: !!env.publicBaseUrl(),
  }
}

export const GET = route({ access: "admin" }, ({ db }) => json(view(db)))

export const PATCH = route({ access: "admin" }, async ({ req, db, user }) => {
  const body = await readJson(req, 2048)
  exact(body, ["retentionDays", "idleMinutes", "maxHours", "publicBaseUrl"])
  db.transaction(() => {
    if (body.retentionDays !== undefined) setSetting(db, "retention_days", String(intIn(body.retentionDays, 1, 3650)))
    if (body.idleMinutes !== undefined) setSetting(db, "session_idle_minutes", String(intIn(body.idleMinutes, 5, 1440)))
    if (body.maxHours !== undefined) setSetting(db, "session_max_hours", String(intIn(body.maxHours, 1, 720)))
    if (body.publicBaseUrl !== undefined) {
      if (env.publicBaseUrl()) throw new HttpError(409, "PUBLIC_BASE_URL is set by the environment")
      const v = str(body.publicBaseUrl, 200, { optional: true })
      if (v) {
        let u: URL
        try {
          u = new URL(v)
        } catch {
          throw new HttpError(400, "Invalid URL")
        }
        if (!["http:", "https:"].includes(u.protocol) || u.username || u.password || u.search || u.hash) throw new HttpError(400, "Invalid URL")
        setSetting(db, "public_base_url", u.origin + u.pathname.replace(/\/+$/, ""))
      } else setSetting(db, "public_base_url", "")
    }
    audit(db, user.id, "settings_changed", { type: "settings", id: "app" })
  })()
  return json(view(db))
})
