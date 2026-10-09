import { route, requireOn } from "@/lib/server/authz"
import { exact, HttpError, json, readJson, str } from "@/lib/server/http"
import { audit } from "@/lib/server/audit"
import { createBot, listBots, parseAllowlist, validateBotName } from "@/lib/server/bots"

export const GET = route({ perm: "tokens:read" }, ({ db }) => json({ bots: listBots(db) }))

export const POST = route({ perm: "tokens:create" }, async ({ req, db, user }) => {
  const body = await readJson(req, 4096)
  exact(body, ["name", "roleIds", "expiresAt", "ipAllowlist"])
  const name = validateBotName(body.name)
  if (!Array.isArray(body.roleIds) || body.roleIds.length > 20 || body.roleIds.some((x) => !Number.isInteger(x))) throw new HttpError(400, "Choose up to 20 roles")
  if (body.roleIds.length) requireOn(db, user, "role:assign")
  const expiry = body.expiresAt === undefined || body.expiresAt === null || body.expiresAt === "" ? null : str(body.expiresAt, 40)
  if (expiry && (!Number.isFinite(Date.parse(expiry)) || Date.parse(expiry) <= Date.now())) throw new HttpError(400, "Expiry must be in the future")
  const allowlist = parseAllowlist(body.ipAllowlist)
  const result = createBot(db, user, { name, roleIds: body.roleIds as number[], expiresAt: expiry ? new Date(expiry).toISOString() : null, allowlist })
  audit(db, user.id, "bot_token_created", { type: "bot", id: result.id }, { name: `bot:${name}`, expiresAt: expiry, roleCount: body.roleIds.length, allowlisted: allowlist.length > 0 })
  return json({ ...result, name: `bot:${name}`, warning: "Copy this token now; it will not be shown again." }, 201)
})
