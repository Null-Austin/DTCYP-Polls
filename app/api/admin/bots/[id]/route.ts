import { route, requireHigherLevelThan, requireOn } from "@/lib/server/authz"
import { exact, HttpError, json, readJson, str } from "@/lib/server/http"
import { audit } from "@/lib/server/audit"
import { listBots, parseAllowlist } from "@/lib/server/bots"
import { nowIso, type DB } from "@/lib/server/db"

type P = { id: string }

function getBot(db: DB, raw: string) {
  const id = Number(raw)
  const row = Number.isInteger(id) ? db.prepare("SELECT u.id, u.username, u.kind, u.disabled_at, b.expires_at, b.revoked_at FROM users u JOIN bots b ON b.user_id = u.id WHERE u.id = ?").get(id) as { id: number; username: string; kind: string; disabled_at: string | null; expires_at: string | null; revoked_at: string | null } | undefined : undefined
  if (!row || row.kind !== "bot") throw new HttpError(404, "Not found")
  return row
}

export const PATCH = route<P>({ perm: ["tokens:read", "tokens:revoke"] }, async ({ req, db, user, params }) => {
  const bot = getBot(db, params.id)
  requireHigherLevelThan(db, user, bot.id)
  requireOn(db, user, "tokens:revoke")
  const body = await readJson(req, 2048)
  exact(body, ["expiresAt", "ipAllowlist", "disabled"])
  if (body.disabled !== undefined && typeof body.disabled !== "boolean") throw new HttpError(400, "Invalid disabled state")
  const expiry = body.expiresAt === undefined ? bot.expires_at : body.expiresAt === null || body.expiresAt === "" ? null : str(body.expiresAt, 40)
  if (expiry && (!Number.isFinite(Date.parse(expiry)) || Date.parse(expiry) <= Date.now())) throw new HttpError(400, "Expiry must be in the future")
  const allow = body.ipAllowlist === undefined ? undefined : parseAllowlist(body.ipAllowlist)
  db.transaction(() => {
    if (body.expiresAt !== undefined || allow !== undefined) db.prepare("UPDATE bots SET expires_at = ?, ip_allowlist = COALESCE(?, ip_allowlist) WHERE user_id = ?").run(expiry, allow === undefined ? null : allow.length ? JSON.stringify(allow) : null, bot.id)
    if (body.disabled !== undefined) {
      db.prepare("UPDATE users SET disabled_at = ? WHERE id = ?").run(body.disabled ? nowIso() : null, bot.id)
      db.prepare("UPDATE bots SET revoked_at = ? WHERE user_id = ?").run(body.disabled ? nowIso() : null, bot.id)
    }
    audit(db, user.id, "bot_updated", { type: "bot", id: bot.id }, { expiry: expiry ?? null, allowlistChanged: allow !== undefined, disabled: typeof body.disabled === "boolean" ? body.disabled : null })
  })()
  return json({ bots: listBots(db) })
})

export const DELETE = route<P>({ perm: "tokens:revoke" }, ({ db, user, params }) => {
  const bot = getBot(db, params.id)
  requireHigherLevelThan(db, user, bot.id)
  db.transaction(() => {
    db.prepare("UPDATE bots SET revoked_at = ? WHERE user_id = ?").run(nowIso(), bot.id)
    audit(db, user.id, "bot_token_revoked", { type: "bot", id: bot.id }, { name: bot.username })
  })()
  return json({ ok: true })
})
