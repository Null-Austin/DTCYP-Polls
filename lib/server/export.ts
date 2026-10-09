import type { DB } from "./db"
import { nowIso } from "./db"
import { csvCell } from "./http"
import { loadQuestions } from "./polls"
import { schemaVersion } from "./db"
import { can, rankableOfUser, type Actor } from "./rbac"
import { HttpError } from "./http"

type Row = Record<string, string | number | null>
type ResponseRow = {
  id: number
  poll_id: string
  link_token: string
  status: string
  submitted_at: string
  device_class: string
  language: string
}

// Everything stored about a poll and its responses. Never includes password hashes or session data.
export function fullExport(db: DB, pollIds: string[] | null, actor: Actor) {
  const requested = pollIds
    ? pollIds.map((id) => db.prepare("SELECT * FROM polls WHERE id = ?").get(id) as Row | undefined).filter((p): p is Row => !!p)
    : (db.prepare("SELECT * FROM polls ORDER BY created_at").all() as Row[])
  const visible = requested.filter((p) => can(db, actor, "polls:read", { pollId: p.id as string, ownerId: p.owner_id as number }))
  if (pollIds && visible.length !== pollIds.length) throw new HttpError(404, "Not found")
  const polls = visible.map((p) => {
    const id = p.id as string
    const res = { pollId: id, ownerId: p.owner_id as number }
    const mayReadResponses = can(db, actor, "responses:read", res)
    const mayReadUrls = can(db, actor, "urls:read", res)
    const questions = loadQuestions(db, id)
    const label = (qid: number | null, oid: number | null) => ({
      question: questions.find((q) => q.id === qid)?.prompt ?? null,
      option: questions.flatMap((q) => q.options).find((o) => o.id === oid)?.label ?? null,
    })
    const answersByResponse = new Map<number, Row[]>()
    for (const a of (mayReadResponses ? db
      .prepare("SELECT a.response_id, a.question_id, a.option_id, a.text FROM answers a JOIN responses r ON r.id = a.response_id WHERE r.poll_id = ? ORDER BY a.id")
      .all(id) : []) as { response_id: number; question_id: number; option_id: number | null; text: string | null }[]) {
      const l = label(a.question_id, a.option_id)
      const list = answersByResponse.get(a.response_id) ?? []
      list.push({ question_id: a.question_id, question: l.question, option_id: a.option_id, option: l.option, text: a.text })
      answersByResponse.set(a.response_id, list)
    }
      const responses = (mayReadResponses ? db.prepare("SELECT * FROM responses WHERE poll_id = ? ORDER BY id").all(id) as ResponseRow[] : []).map((r) => ({
        ...r,
        link_token: mayReadUrls ? r.link_token : "",
      answers: answersByResponse.get(r.id) ?? [],
    }))
    return {
      poll: p,
      owner: (() => {
        const ownerId = p.owner_id as number
        const ownerRank = rankableOfUser(db, ownerId)
        const mayReadOwner = actor.isRoot || ownerId === actor.id || (can(db, actor, "users:read") && !!ownerRank && !ownerRank.isRoot && actor.level > ownerRank.level)
        return mayReadOwner ? db.prepare("SELECT id, username, email, role FROM users WHERE id = ?").get(ownerId) ?? null : null
      })(),
      questions,
      shares: db
        .prepare("SELECT u.username, s.permission, s.created_at FROM poll_shares s JOIN users u ON u.id = s.user_id WHERE s.poll_id = ?")
        .all(id),
        batches: mayReadUrls ? db.prepare("SELECT * FROM link_batches WHERE poll_id = ? ORDER BY id").all(id) : [],
        groups: (db.prepare("SELECT * FROM distribution_groups WHERE poll_id = ? ORDER BY position, id").all(id) as { id: number }[]).filter((g) => can(db, actor, "groups:read", { ...res, groupId: g.id })),
      links: mayReadUrls ? db.prepare("SELECT rowid AS id, token, batch_id, group_id, display_title, notes, enabled, created_at, revoked_at FROM links WHERE poll_id = ? ORDER BY rowid").all(id) : [],
      responses,
    }
  })
  const mayReadUsers = can(db, actor, "users:read")
  const rawUsers = db.prepare("SELECT id, username, email, role, kind, is_root AS isRoot, must_change_password AS mustChangePassword, disabled_at AS disabledAt, created_at AS createdAt, last_login_at AS lastLoginAt FROM users ORDER BY id").all() as { id: number }[]
  const users = (mayReadUsers ? rawUsers.filter((u) => {
    if (u.id === actor.id || actor.isRoot) return true
    const target = rankableOfUser(db, u.id)
    return !!target && actor.level > target.level && !target.isRoot
  }) : rawUsers.filter((u) => u.id === actor.id)).map((u) => ({
      ...u,
      roles: can(db, actor, "role:read") ? db.prepare("SELECT r.id, r.name, r.color, r.level, r.position FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ? ORDER BY r.position").all(u.id) : [],
    }))
  const tableExists = (table: string) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)
  const auditLog = can(db, actor, "audit:read") && tableExists("audit_log") ? db.prepare("SELECT * FROM audit_log ORDER BY id").all() : []
  const webhooks = can(db, actor, "admin:webhooks") && tableExists("webhooks") ? db.prepare("SELECT * FROM webhooks").all() : []
  const mayReadTokens = can(db, actor, "tokens:read")
  return {
    exportedAt: nowIso(),
    schemaVersion: schemaVersion(db),
    scope: pollIds ? "poll" : "all",
    polls,
    users,
    roles: can(db, actor, "role:read") ? db.prepare("SELECT * FROM roles ORDER BY position, id").all() : [],
    rolePermissions: can(db, actor, "role:read") ? db.prepare("SELECT * FROM role_permissions ORDER BY role_id, permission, scope").all() : [],
    userRoles: can(db, actor, "role:read") ? db.prepare("SELECT * FROM user_roles ORDER BY user_id, role_id").all() : [],
    bots: mayReadTokens ? db.prepare("SELECT user_id, token_hash, token_prefix, created_by, created_at, expires_at, revoked_at, last_used_at, last_used_ip, ip_allowlist FROM bots ORDER BY user_id").all() : [],
    settings: can(db, actor, "admin:settings") ? db.prepare("SELECT key, value FROM settings ORDER BY key").all() : [],
    auditLog,
    webhooks,
    uploadedAssets: [],
  }
}

// One row per answer (or per response with no answers), with all tracked response fields.
export function flatCsv(data: ReturnType<typeof fullExport>): string {
  const head = ["poll_id", "response_id", "link_token", "batch_id", "batch_label", "status", "submitted_at", "device_class", "language", "question", "option", "text"]
  const lines = [head.join(",")]
  for (const p of data.polls) {
    const batchOf = new Map((p.links as { token: string; batch_id: number }[]).map((l) => [l.token, l.batch_id]))
    const labelOf = new Map((p.batches as { id: number; label: string }[]).map((b) => [b.id, b.label]))
    for (const r of p.responses) {
      const batch = batchOf.get(r.link_token as string) ?? null
      const base = [p.poll.id, r.id, r.link_token, batch, batch === null ? "" : labelOf.get(batch) ?? "", r.status, r.submitted_at, r.device_class, r.language]
      const rows = r.answers.length ? r.answers : [{ question: "", option: "", text: "" }]
      for (const a of rows) lines.push([...base, a.question ?? "", a.option ?? "", a.text ?? ""].map((v) => csvCell(v ?? "")).join(","))
    }
  }
  return lines.join("\r\n") + "\r\n"
}
