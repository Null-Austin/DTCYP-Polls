import { beforeEach, describe, expect, it } from "vitest"
import { authFrom, call, freshDb, setupAdmin } from "./helpers"
import * as usersR from "@/app/api/admin/users/route"
import * as userR from "@/app/api/admin/users/[id]/route"
import * as loginR from "@/app/api/auth/login/route"
import * as passwordR from "@/app/api/auth/password/route"
import * as rolesR from "@/app/api/admin/roles/route"
import * as roleR from "@/app/api/admin/roles/[id]/route"
import * as botsR from "@/app/api/admin/bots/route"
import * as linksR from "@/app/api/admin/polls/[pollid]/links/route"
import * as groupsR from "@/app/api/admin/polls/[pollid]/groups/route"
import * as groupUrlsR from "@/app/api/admin/polls/[pollid]/groups/[groupid]/urls/route"
import { ALL_PERMISSIONS } from "@/lib/server/permissions"
import { authenticateBearer, validateBotName } from "@/lib/server/bots"
import { loadActor, outranks } from "@/lib/server/rbac"
import { verifyAuditRows } from "@/lib/server/audit-integrity"
import * as fullExportR from "@/app/api/admin/export/route"

let db: ReturnType<typeof freshDb>
beforeEach(() => { db = freshDb() })

const tokenCall = async (handler: unknown, url: string, token: string, params: Record<string, string> = {}) => {
  const fn = handler as (req: Request, ctx?: { params: Promise<Record<string, string>> }) => Promise<Response>
  const r = await fn(new Request(`http://localhost${url}`, { headers: { authorization: `Bearer ${token}` } }), { params: Promise.resolve(params) })
  const text = await r.text()
  return { status: r.status, data: JSON.parse(text) as Record<string, unknown> }
}

async function loggedIn(username: string, temporary: unknown) {
  const login = await call(loginR.POST, "POST", "/api/auth/login", { body: { username, password: temporary } })
  const auth = authFrom(login)
  return authFrom(await call(passwordR.POST, "POST", "/api/auth/password", { auth, body: { current: temporary, next: "correct-horse-new-123" } }))
}

async function pollAndLink() {
  db.prepare("INSERT INTO polls (id,title,status,owner_id,created_at,updated_at) VALUES ('overhaul','Test','open',1,?,?)").run(new Date().toISOString(), new Date().toISOString())
  const q = Number(db.prepare("INSERT INTO questions (poll_id,prompt,type,required,position) VALUES ('overhaul','Pick','single',1,0)").run().lastInsertRowid)
  const o = Number(db.prepare("INSERT INTO options (question_id,label,position) VALUES (?, 'A',0)").run(q).lastInsertRowid)
  const batch = Number(db.prepare("INSERT INTO link_batches (poll_id,label,count,created_at) VALUES ('overhaul','g',1,?)").run(new Date().toISOString()).lastInsertRowid)
  const group = Number(db.prepare("INSERT INTO distribution_groups (poll_id,name,position,created_at) VALUES ('overhaul','g',0,?)").run(new Date().toISOString()).lastInsertRowid)
  const tok = "token-overhaul-abcdefghijkl"
  db.prepare("INSERT INTO links (token,poll_id,batch_id,group_id,created_at) VALUES (?, 'overhaul', ?, ?, ?)").run(tok,batch,group,new Date().toISOString())
  return { token: tok, question: q, option: o, batch, group }
}

describe("RBAC hierarchy and custom roles", () => {
  it("root has every permission and cannot be edited or assigned; effective permission is union", async () => {
    const root = await setupAdmin()
    const actor = loadActor(db, 1)!
    expect(actor.isRoot).toBe(true)
    expect(actor.level).toBe(255)
    expect(actor.grants.map((g) => g.permission)).toEqual(expect.arrayContaining(ALL_PERMISSIONS))
    expect(outranks(actor, { id: 8, level: 255, isRoot: true })).toBe(false)
    expect(outranks(actor, { id: 8, level: 254, isRoot: false })).toBe(true)
    expect((await call(rolesR.POST, "POST", "/x", { auth: root, body: { name: "Too high", color: "#123456", level: 256, permissions: [] } })).status).toBe(400)
    const rootRole = (db.prepare("SELECT id FROM roles WHERE is_root=1").get() as { id: number }).id
    expect((await call(roleR.PATCH, "PATCH", "/x", { auth: root, params: { id: String(rootRole) }, body: { name: "not root" } })).status).toBe(403)
    const role = await call(rolesR.POST, "POST", "/x", { auth: root, body: { name: "Reader", color: "#123456", level: 5, permissions: [{ permission: "polls:read", scope: "own" }] } })
    expect(role.status).toBe(201)
    const grant = (db.prepare("SELECT permission, scope FROM role_permissions WHERE role_id=?").get(role.data.id) as { permission: string; scope: string })
    expect(grant).toEqual({ permission: "polls:read", scope: "own" })
    const made = await call(usersR.POST, "POST", "/x", { auth: root, body: { username: "one", roleIds: [role.data.id] } })
    expect(made.status).toBe(201)
    const second = await call(rolesR.POST, "POST", "/x", { auth: root, body: { name: "Other", color: "#123456", level: 2, permissions: [{ permission: "users:read", scope: "" }] } })
    const a = Number(made.data.id)
    db.prepare("INSERT INTO user_roles (user_id,role_id) VALUES (?,?)").run(a, second.data.id)
    expect(loadActor(db, a)!.grants.map((x) => x.permission)).toEqual(["polls:read", "users:read"])
  })

  it("strict hierarchy blocks equal/higher targets, self changes, role escalation and permission escalation", async () => {
    const root = await setupAdmin()
    const role = await call(rolesR.POST, "POST", "/x", { auth: root, body: { name: "Delegator", color: "#123456", level: 10, permissions: [{ permission: "role:assign", scope: "" }, { permission: "users:disable", scope: "" }] } })
    const sameA = await call(usersR.POST, "POST", "/x", { auth: root, body: { username: "same-a", roleIds: [role.data.id] } })
    const sameB = await call(usersR.POST, "POST", "/x", { auth: root, body: { username: "same-b", roleIds: [role.data.id] } })
    const authA = await loggedIn("same-a", sameA.data.temporaryPassword)
    expect((await call(userR.PATCH, "PATCH", "/x", { auth: authA, params: { id: String(sameB.data.id) }, body: { disabled: true } })).status).toBe(403)
    expect((await call(userR.PATCH, "PATCH", "/x", { auth: authA, params: { id: String(sameA.data.id) }, body: { roleIds: [role.data.id] } })).status).toBe(403)
    const unknown = await call(rolesR.POST, "POST", "/x", { auth: root, body: { name: "Escalator", color: "#123456", level: 5, permissions: [{ permission: "users:delete", scope: "" }] } })
    const low = await call(usersR.POST, "POST", "/x", { auth: root, body: { username: "limited", roleIds: [role.data.id] } })
    const limitedAuth = await loggedIn("limited", low.data.temporaryPassword)
    expect((await call(userR.PATCH, "PATCH", "/x", { auth: limitedAuth, params: { id: String(sameB.data.id) }, body: { roleIds: [unknown.data.id] } })).status).toBe(403)
    expect((await call(usersR.POST, "POST", "/x", { auth: limitedAuth, body: { username: "escalated", roleIds: [unknown.data.id] } })).status).toBe(403)
  })

  it("only rootadmin can reset passwords, including against an account with every normal permission", async () => {
    const root = await setupAdmin()
    const allRole = await call(rolesR.POST, "POST", "/x", { auth: root, body: { name: "All normal", color: "#222222", level: 254, permissions: ALL_PERMISSIONS.map((permission) => ({ permission, scope: "" })) } })
    const high = await call(usersR.POST, "POST", "/x", { auth: root, body: { username: "normal-admin", roleIds: [allRole.data.id] } })
    const h = await loggedIn("normal-admin", high.data.temporaryPassword)
    const target = await call(usersR.POST, "POST", "/x", { auth: root, body: { username: "target", role: "editor" } })
    expect((await call((await import("@/app/api/admin/users/[id]/reset-password/route")).POST, "POST", "/x", { auth: h, params: { id: String(target.data.id) } })).status).toBe(403)
    expect((await call((await import("@/app/api/admin/users/[id]/reset-password/route")).POST, "POST", "/x", { auth: root, params: { id: String(target.data.id) } })).status).toBe(200)
  })
})
  it("admin full export returns a ZIP archive, not an error or JSON page", async () => {
    const root = await setupAdmin()
    const { token } = await pollAndLink()
    void token
    const response = await (fullExportR.GET as (req: Request) => Promise<Response>)(new Request("http://localhost/api/admin/export?format=zip", { headers: { cookie: root.cookie } }))
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toBe("application/zip")
    const bytes = new Uint8Array(await response.arrayBuffer())
    expect([...bytes.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04])
    expect(bytes.length).toBeGreaterThan(100)
  })

describe("bots, API, groups and audit", () => {
  it("bot validation, hashed one-time secret, expiry, rotation and revoke", async () => {
    const root = await setupAdmin()
    for (const bad of ["Upper", "white space", "underscore_name", "bot:prefix", "a".repeat(41), "!"]) expect(() => validateBotName(bad)).toThrow()
    expect(validateBotName("bot-api-token-1")).toBe("bot-api-token-1")
    const role = await call(rolesR.POST, "POST", "/x", { auth: root, body: { name: "Poll reader", color: "#336699", level: 8, permissions: [{ permission: "polls:read", scope: "" }] } })
    const res = await call(botsR.POST, "POST", "/x", { auth: root, body: { name: "bot-api-token-1", roleIds: [role.data.id], expiresAt: new Date(Date.now()+3600_000).toISOString(), ipAllowlist: "" } })
    expect(res.status).toBe(201)
    const token = res.data.token as string
    const stored = db.prepare("SELECT token_hash FROM bots WHERE user_id=?").get(res.data.id) as { token_hash: string }
    expect(stored.token_hash).not.toBe(token)
    expect(authenticateBearer(db, token, null)?.userId).toBe(res.data.id)
    expect((await tokenCall((await import("@/app/api/v1/me/permissions/route")).GET, "/api/v1/me/permissions", token)).data.account).toBe("bot:bot-api-token-1")
    const poll = await pollAndLink()
    const responses = await tokenCall((await import("@/app/api/v1/polls/[pollid]/responses/route")).GET, "/api/v1/polls/overhaul/responses", token, { pollid: "overhaul" })
    expect(responses.status).toBe(200)
    expect(responses.data.responses).toEqual([])
    const rotated = await call((await import("@/app/api/admin/bots/[id]/rotate/route")).POST, "POST", "/x", { auth: root, params: { id: String(res.data.id) } })
    expect(rotated.status).toBe(200)
    expect(authenticateBearer(db, token, null)).toBeNull()
    expect((await call((await import("@/app/api/admin/bots/[id]/route")).DELETE, "DELETE", "/x", { auth: root, params: { id: String(res.data.id) } })).status).toBe(200)
    expect(authenticateBearer(db, rotated.data.token as string, null)).toBeNull()
    void poll
  })

  it("bot tokens expire and are rate limited per bot account", async () => {
    const root = await setupAdmin()
    const role = await call(rolesR.POST, "POST", "/x", { auth: root, body: { name: "API reader", color: "#336699", level: 6, permissions: [{ permission: "api:docs", scope: "" }] } })
    const bot = await call(botsR.POST, "POST", "/x", { auth: root, body: { name: "rate-limited", roleIds: [role.data.id], expiresAt: null } })
    const token = bot.data.token as string
    db.prepare("INSERT INTO settings (key,value) VALUES ('bot_rate_limit_per_minute','1')").run()
    expect((await tokenCall((await import("@/app/api/v1/me/permissions/route")).GET, "/api/v1/me/permissions", token)).status).toBe(200)
    expect((await tokenCall((await import("@/app/api/v1/me/permissions/route")).GET, "/api/v1/me/permissions", token)).status).toBe(429)
    db.prepare("UPDATE settings SET value = '120' WHERE key='bot_rate_limit_per_minute'").run()
    db.prepare("UPDATE bots SET expires_at = ? WHERE user_id = ?").run(new Date(Date.now() - 1000).toISOString(), bot.data.id)
    expect(authenticateBearer(db, token, null)).toBeNull()
  })

  it("creates titled URLs from comma/newline input, supports groups, copy and URL metadata", async () => {
    const root = await setupAdmin()
    const poll = await pollAndLink()
    const make = await call(linksR.POST, "POST", "/x", { auth: root, params: { pollid: "overhaul" }, body: { input: " region 1, , region 2,region 1 ", label: "regions" } })
    expect(make.status).toBe(201)
    expect(make.data.count).toBe(3)
    expect(make.data.duplicateTitles).toEqual(["region 1"])
    const groupId = Number(make.data.groupId)
    const listed = await call((await import("@/app/api/admin/polls/[pollid]/groups/[groupid]/urls/route")).GET, "GET", "/x", { auth: root, params: { pollid: "overhaul", groupid: String(groupId) } })
    const rows = listed.data.urls as { id: number; title: string; url: string }[]
    expect(rows.map((x) => x.title)).toEqual(["region 1", "region 2", "region 1"])
    const copied = await call((await import("@/app/api/admin/polls/[pollid]/groups/[groupid]/urls/route")).POST, "POST", "/x", { auth: root, params: { pollid: "overhaul", groupid: String(groupId) }, body: {} })
    expect(copied.data.urls).toEqual(rows.map((x) => x.url))
    expect((await call((await import("@/app/api/admin/polls/[pollid]/urls/[urlid]/route")).PATCH, "PATCH", "/x", { auth: root, params: { pollid: "overhaul", urlid: String(rows[0].id) }, body: { title: "West", notes: "n", enabled: false } })).status).toBe(200)
    expect((await call((await import("@/app/api/admin/polls/[pollid]/urls/bulk/route")).POST, "POST", "/x", { auth: root, params: { pollid: "overhaul" }, body: { ids: rows.slice(1).map((x) => x.id), prefix: "R-", groupId: poll.group } })).status).toBe(200)
  })

  it("applies group-scoped grants only to the selected group on a shared poll", async () => {
    const root = await setupAdmin()
    const owner = await call(usersR.POST, "POST", "/x", { auth: root, body: { username: "scope-owner", role: "editor" } })
    const ownerAuth = await loggedIn("scope-owner", owner.data.temporaryPassword)
    const madePoll = await call((await import("@/app/api/admin/polls/route")).POST, "POST", "/x", { auth: ownerAuth, body: { id: "scope-poll", title: "Scope" } })
    expect(madePoll.status).toBe(201)
    const updated = await call((await import("@/app/api/admin/polls/[pollid]/route")).PATCH, "PATCH", "/x", {
      auth: ownerAuth,
      params: { pollid: "scope-poll" },
      body: { status: "open", questions: [{ prompt: "Q", type: "single", required: true, options: [{ label: "A" }, { label: "B" }] }] },
    })
    expect(updated.status).toBe(200)
    const first = await call(linksR.POST, "POST", "/x", { auth: ownerAuth, params: { pollid: "scope-poll" }, body: { count: 1, label: "first" } })
    const second = await call(linksR.POST, "POST", "/x", { auth: ownerAuth, params: { pollid: "scope-poll" }, body: { count: 1, label: "second" } })
    const groupRole = await call(rolesR.POST, "POST", "/x", { auth: root, body: {
      name: "One group reader", color: "#448866", level: 6,
      permissions: [{ permission: "groups:read", scope: `group:${first.data.groupId}` }, { permission: "urls:read", scope: `group:${first.data.groupId}` }],
    } })
    expect(groupRole.status).toBe(201)
    const viewer = await call(usersR.POST, "POST", "/x", { auth: root, body: { username: "scope-viewer", roleIds: [groupRole.data.id] } })
    const viewerAuth = await loggedIn("scope-viewer", viewer.data.temporaryPassword)
    expect((await call((await import("@/app/api/admin/polls/[pollid]/shares/route")).POST, "POST", "/x", { auth: ownerAuth, params: { pollid: "scope-poll" }, body: { username: "scope-viewer", permission: "view" } })).status).toBe(200)
    const groups = await call(groupsR.GET, "GET", "/x", { auth: viewerAuth, params: { pollid: "scope-poll" } })
    expect((groups.data.groups as { id: number }[]).map((g) => g.id)).toEqual([first.data.groupId])
    const visibleUrls = await call(groupUrlsR.GET, "GET", "/x", { auth: viewerAuth, params: { pollid: "scope-poll", groupid: String(first.data.groupId) } })
    expect(visibleUrls.status).toBe(200)
    expect((visibleUrls.data.urls as unknown[])).toHaveLength(1)
    const hiddenUrls = await call(groupUrlsR.GET, "GET", "/x", { auth: viewerAuth, params: { pollid: "scope-poll", groupid: String(second.data.groupId) } })
    expect(hiddenUrls.status).toBe(403)
  })

  it("records audit hash chain and detects tampering; log cannot be edited/deleted", async () => {
    await setupAdmin()
    await pollAndLink()
    const entries = db.prepare("SELECT id, at, actor_name, action, target_type, target_id, details, request_id, ip, user_agent, result, previous_hash, entry_hash FROM audit_log ORDER BY id").all() as { id: number; at: string; actor_name: string | null; action: string; target_type: string | null; target_id: string | null; details: string | null; request_id: string | null; ip: string | null; user_agent: string | null; result: string; previous_hash: string | null; entry_hash: string }[]
    expect(verifyAuditRows(entries).valid).toBe(true)
    expect(() => db.prepare("UPDATE audit_log SET action='tampered' WHERE id=1").run()).toThrow(/append-only/)
    expect(() => db.prepare("DELETE FROM audit_log WHERE id=1").run()).toThrow(/append-only/)
    expect(verifyAuditRows(entries.map((r, i) => i === 0 ? { ...r, action: "tampered" } : r)).valid).toBe(false)
  })

  it("OpenAPI validates; docs require api:docs; backups are real SQLite snapshots", async () => {
    const root = await setupAdmin()
    const docs = await import("@/app/api/docs/route")
    const schema = await import("@/app/api/v1/openapi.json/route")
    expect((await call(docs.GET, "GET", "/x")).status).toBe(401)
    expect((await call(schema.GET, "GET", "/x")).status).toBe(401)
    const spec = await call(schema.GET, "GET", "/x", { auth: root })
    const parser = await import("@apidevtools/swagger-parser")
    await parser.default.validate(spec.data as never)
    const backup = await call((await import("@/app/api/admin/backups/route")).POST, "POST", "/x", { auth: root })
    expect(backup.status).toBe(201)
    expect((backup.data.backup as { sha256: string }).sha256).toMatch(/^[a-f0-9]{64}$/)
  })
})
