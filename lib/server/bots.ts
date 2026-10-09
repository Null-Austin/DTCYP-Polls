import { createHash, randomBytes } from "node:crypto"
import { isIP } from "node:net"
import type { DB } from "./db"
import { nowIso } from "./db"
import { getSetting } from "./audit"
import { HttpError } from "./http"
import { canGrant, canManageRole, type Actor } from "./rbac"
import { isPermission } from "./permissions"
import { MAX_LEVEL } from "./permissions"

export const BOT_NAME = /^[a-z0-9-]{1,40}$/
export const BOT_PREFIX = "bot:"
export const TOKEN_PREFIX = "dtp_"

export const hashToken = (t: string) => createHash("sha256").update(t).digest("hex")

export function validateBotName(v: unknown): string {
  if (typeof v !== "string" || !BOT_NAME.test(v)) throw new HttpError(400, "Bot names use lowercase letters, digits and dashes only (1-40 characters)")
  return v
}

export function newToken() {
  const secret = randomBytes(32).toString("base64url")
  const token = `${TOKEN_PREFIX}${secret}`
  return { token, hash: hashToken(token), prefix: token.slice(0, 12) }
}

export function botRateLimitPerMinute(db: DB): number {
  return Number(getSetting(db, "bot_rate_limit_per_minute")) || 120
}

function ipInList(ip: string, list: string[]): boolean {
  return list.some((entry) => {
    if (entry === ip) return true
    const m = /^(\d+\.\d+\.\d+\.\d+)\/(\d{1,2})$/.exec(entry)
    if (!m || isIP(ip) !== 4) return false
    const toInt = (a: string) => a.split(".").reduce((n, x) => (n << 8) + Number(x), 0) >>> 0
    const bits = Number(m[2])
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0
    return (toInt(ip) & mask) === (toInt(m[1]) & mask)
  })
}

export function parseAllowlist(v: unknown): string[] {
  if (v === undefined || v === null || v === "") return []
  const list = Array.isArray(v) ? v : typeof v === "string" ? v.split(/[\s,]+/).filter(Boolean) : null
  if (!list || list.length > 50) throw new HttpError(400, "Invalid IP allowlist")
  for (const e of list) {
    const ok = typeof e === "string" && (isIP(e) !== 0 || /^(\d+\.\d+\.\d+\.\d+)\/(\d{1,2})$/.test(e))
    if (!ok) throw new HttpError(400, "Invalid IP allowlist entry")
  }
  return list as string[]
}

export function authenticateBearer(db: DB, token: string, ip: string | null): { userId: number } | null {
  if (!token.startsWith(TOKEN_PREFIX) || token.length > 200) return null
  const row = db
    .prepare(
      `SELECT b.user_id, b.expires_at, b.revoked_at, b.ip_allowlist, b.last_used_at, u.disabled_at
       FROM bots b JOIN users u ON u.id = b.user_id WHERE b.token_hash = ? AND u.kind = 'bot'`,
    )
    .get(hashToken(token)) as { user_id: number; expires_at: string | null; revoked_at: string | null; ip_allowlist: string | null; last_used_at: string | null; disabled_at: string | null } | undefined
  if (!row || row.revoked_at || row.disabled_at) return null
  if (row.expires_at && Date.parse(row.expires_at) <= Date.now()) return null
  const allow = row.ip_allowlist ? (JSON.parse(row.ip_allowlist) as string[]) : []
  // An allowlist with no known client address fails closed.
  if (allow.length && (!ip || !ipInList(ip, allow))) return null
  if (!row.last_used_at || Date.now() - Date.parse(row.last_used_at) > 60_000) {
    db.prepare("UPDATE bots SET last_used_at = ?, last_used_ip = ? WHERE user_id = ?").run(nowIso(), ip, row.user_id)
  }
  return { userId: row.user_id }
}

export type BotView = {
  id: number
  name: string
  username: string
  level: number
  createdBy: string | null
  createdAt: string
  expiresAt: string | null
  revokedAt: string | null
  lastUsedAt: string | null
  lastUsedIp: string | null
  tokenPrefix: string | null
  ipAllowlist: string[]
  disabledAt: string | null
}

export function listBots(db: DB): BotView[] {
  const rows = db
    .prepare(
      `SELECT u.id, u.username, u.disabled_at, b.created_at, b.expires_at, b.revoked_at, b.last_used_at, b.last_used_ip, b.token_prefix, b.ip_allowlist,
        c.username AS created_by,
        COALESCE((SELECT MAX(r.level) FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id), 0) AS level
       FROM bots b JOIN users u ON u.id = b.user_id LEFT JOIN users c ON c.id = b.created_by ORDER BY u.username`,
    )
    .all() as { id: number; username: string; disabled_at: string | null; created_at: string; expires_at: string | null; revoked_at: string | null; last_used_at: string | null; last_used_ip: string | null; token_prefix: string | null; ip_allowlist: string | null; created_by: string | null; level: number }[]
  return rows.map((r) => ({
    id: r.id,
    name: r.username.slice(BOT_PREFIX.length),
    username: r.username,
    level: r.level,
    createdBy: r.created_by,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    revokedAt: r.revoked_at,
    lastUsedAt: r.last_used_at,
    lastUsedIp: r.last_used_ip,
    tokenPrefix: r.token_prefix,
    ipAllowlist: r.ip_allowlist ? JSON.parse(r.ip_allowlist) : [],
    disabledAt: r.disabled_at,
  }))
}

export function createBot(
  db: DB,
  actor: Actor,
  input: { name: string; roleIds: number[]; expiresAt: string | null; allowlist: string[] },
): { id: number; token: string } {
  return db.transaction(() => {
    const username = `${BOT_PREFIX}${input.name}`
    if (db.prepare("SELECT 1 FROM users WHERE username = ?").get(username)) throw new HttpError(409, "A bot with that name already exists")
    // A bot can never outrank its creator, and can only get roles the creator may hand out.
    const roles = input.roleIds.map((id) => db.prepare("SELECT * FROM roles WHERE id = ?").get(id) as { id: number; level: number; is_root: number } | undefined)
    for (const r of roles) {
      if (!r) throw new HttpError(400, "Unknown role")
      if (!canManageRole(actor, r) || r.level >= MAX_LEVEL) throw new HttpError(403, "You cannot give a bot that role")
      const grants = db.prepare("SELECT permission, scope FROM role_permissions WHERE role_id = ?").all(r.id) as { permission: string; scope: string }[]
      if (grants.some((g) => !isPermission(g.permission) || !canGrant(actor, g.permission, g.scope))) throw new HttpError(403, "You cannot grant permissions you do not hold")
    }
    const { token, hash, prefix } = newToken()
    const uid = Number(
      db
        .prepare("INSERT INTO users (username, email, password_hash, role, must_change_password, kind, created_at) VALUES (?, NULL, '!', 'editor', 0, 'bot', ?)")
        .run(username, nowIso()).lastInsertRowid,
    )
    db.prepare("INSERT INTO bots (user_id, token_hash, token_prefix, created_by, created_at, expires_at, ip_allowlist) VALUES (?,?,?,?,?,?,?)").run(
      uid, hash, prefix, actor.id, nowIso(), input.expiresAt, input.allowlist.length ? JSON.stringify(input.allowlist) : null,
    )
    const link = db.prepare("INSERT INTO user_roles (user_id, role_id) VALUES (?,?)")
    for (const r of roles) link.run(uid, r!.id)
    return { id: uid, token }
  }).immediate()
}

// The previous secret stops working immediately; the new one is returned once.
export function rotateBot(db: DB, botId: number): string {
  const { token, hash, prefix } = newToken()
  const r = db.prepare("UPDATE bots SET token_hash = ?, token_prefix = ?, revoked_at = NULL WHERE user_id = ?").run(hash, prefix, botId)
  if (!r.changes) throw new HttpError(404, "Not found")
  return token
}
