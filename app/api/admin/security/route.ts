import { route } from "@/lib/server/authz"
import { json } from "@/lib/server/http"

export const GET = route({ perm: "admin:security" }, ({ db }) => {
  const sessions = db.prepare(
    `SELECT s.rowid AS id, u.id AS userId, u.username, u.kind, u.is_root AS isRoot, s.created_at AS createdAt, s.expires_at AS expiresAt, s.last_seen_at AS lastSeenAt
     FROM sessions s JOIN users u ON u.id = s.user_id WHERE u.disabled_at IS NULL ORDER BY s.last_seen_at DESC LIMIT 500`,
  ).all()
  const failed = db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action IN ('login_failed','login_blocked_locked') AND at >= ?").get(new Date(Date.now() - 7 * 86_400_000).toISOString()) as { n: number }
  const inactive = db.prepare("SELECT id, username, kind, last_login_at AS lastLoginAt FROM users WHERE disabled_at IS NULL AND (last_login_at IS NULL OR last_login_at < ?) ORDER BY last_login_at LIMIT 100").all(new Date(Date.now() - 90 * 86_400_000).toISOString())
  const bots = db.prepare("SELECT u.username, b.expires_at AS expiresAt, b.last_used_at AS lastUsedAt FROM bots b JOIN users u ON u.id = b.user_id WHERE b.revoked_at IS NULL AND (b.expires_at IS NULL OR b.expires_at < ? OR b.last_used_at IS NULL OR b.last_used_at < ?) ORDER BY b.expires_at LIMIT 100").all(new Date(Date.now() + 14 * 86_400_000).toISOString(), new Date(Date.now() - 90 * 86_400_000).toISOString())
  return json({ failedLoginsLast7Days: failed.n, sessions, inactiveAccounts: inactive, expiringOrUnusedBots: bots })
})
