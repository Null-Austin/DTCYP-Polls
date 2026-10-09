import { beforeEach, describe, expect, it } from "vitest"
import { authFrom, call, freshDb, PASSWORD, setupAdmin, type Auth } from "./helpers"
import * as setupR from "@/app/api/auth/setup/route"
import * as statusR from "@/app/api/auth/status/route"
import * as loginR from "@/app/api/auth/login/route"
import * as meR from "@/app/api/auth/me/route"
import * as logoutR from "@/app/api/auth/logout/route"
import * as pollsR from "@/app/api/admin/polls/route"
import * as pollR from "@/app/api/admin/polls/[pollid]/route"
import * as actionR from "@/app/api/admin/polls/[pollid]/action/route"
import * as linksR from "@/app/api/admin/polls/[pollid]/links/route"
import * as exportR from "@/app/api/admin/batches/[batchid]/export/route"
import * as revokeBatchR from "@/app/api/admin/batches/[batchid]/revoke/route"
import * as resultsR from "@/app/api/admin/polls/[pollid]/results/route"
import * as usersR from "@/app/api/admin/users/route"
import * as userR from "@/app/api/admin/users/[id]/route"
import * as resetR from "@/app/api/admin/users/[id]/reset-password/route"
import * as pwR from "@/app/api/auth/password/route"
import * as publicR from "@/app/api/polls/[pollid]/route"
import * as submitR from "@/app/api/polls/[pollid]/responses/route"
import * as auditR from "@/app/api/admin/audit/route"
import * as settingsR from "@/app/api/admin/settings/route"
import * as dashR from "@/app/api/admin/dashboard/route"
import * as fullR from "@/app/api/admin/export/route"
import * as sharesR from "@/app/api/admin/polls/[pollid]/shares/route"
import * as revokeLinkR from "@/app/api/admin/polls/[pollid]/links/revoke/route"
import { runJobs } from "@/lib/server/jobs"
import { cookieName, sessionFromId } from "@/lib/server/auth"

let db: ReturnType<typeof freshDb>
beforeEach(() => {
  db = freshDb()
})

const QUESTIONS = [
  { prompt: "Pick one", type: "single", required: true, options: [{ label: "A" }, { label: "B" }] },
  { prompt: "Say more", type: "text", required: false, options: [] },
]

async function makePoll(auth: Auth, id = "lunch", links = 5, verify = true) {
  await call(pollsR.POST, "POST", "/api/admin/polls", { auth, body: { id, title: "Lunch" } })
  const r = await call(pollR.PATCH, "PATCH", `/x`, {
    auth,
    params: { pollid: id },
    body: { status: "open", requireVerification: verify, questions: QUESTIONS },
  })
  expect(r.status).toBe(200)
  const b = await call(linksR.POST, "POST", "/x", { auth, params: { pollid: id }, body: { count: links, label: "t" } })
  expect(b.status).toBe(201)
  const tokens = (db.prepare("SELECT token FROM links WHERE poll_id = ? ORDER BY rowid").all(id) as { token: string }[]).map((t) => t.token)
  const detail = (await call(pollR.GET, "GET", "/x", { auth, params: { pollid: id } })).data as {
    questions: { id: number; options: { id: number }[] }[]
  }
  return { tokens, q: detail.questions, batchId: b.data.batchId as number }
}

const answer = (q: { id: number; options: { id: number }[] }[], extra: Record<string, unknown> = {}) => ({
  answers: [{ questionId: q[0].id, optionIds: [q[0].options[0].id] }],
  ...extra,
})

const submit = (id: string, token: string, q: { id: number; options: { id: number }[] }[], headers?: Record<string, string>) =>
  call(submitR.POST, "POST", `/x`, { params: { pollid: id }, body: answer(q, { token }), headers })

const statuses = () => (db.prepare("SELECT status FROM responses ORDER BY id").all() as { status: string }[]).map((r) => r.status)

describe("verification", () => {
  it("first submission is verified, later ones unverified, and the respondent is not told", async () => {
    const admin = await setupAdmin()
    const { tokens, q } = await makePoll(admin)
    const a = await submit("lunch", tokens[0], q)
    const b = await submit("lunch", tokens[0], q)
    const c = await submit("lunch", tokens[1], q)
    expect([a.status, b.status, c.status]).toEqual([201, 201, 201])
    expect(a.data).toEqual({ ok: true })
    expect(b.data).toEqual({ ok: true })
    expect(statuses()).toEqual(["verified", "unverified", "verified"])
  })

  it("concurrent submissions on one link give exactly one verified row", async () => {
    const admin = await setupAdmin()
    const { tokens, q } = await makePoll(admin)
    await Promise.all(Array.from({ length: 15 }, () => submit("lunch", tokens[0], q)))
    const s = statuses()
    expect(s).toHaveLength(15)
    expect(s.filter((x) => x === "verified")).toHaveLength(1)
  })

  it("the database itself refuses a second verified row for a token", async () => {
    const admin = await setupAdmin()
    const { tokens, q } = await makePoll(admin)
    await submit("lunch", tokens[0], q)
    expect(() =>
      db.prepare("INSERT INTO responses (poll_id, link_token, status, submitted_at, device_class, language) VALUES ('lunch', ?, 'verified', 'x', 'desktop', 'en')").run(tokens[0]),
    ).toThrow()
  })

  it("verification off: every submission is saved as accepted and counted as verified", async () => {
    const admin = await setupAdmin()
    const { tokens, q } = await makePoll(admin, "open-poll", 2, false)
    await submit("open-poll", tokens[0], q)
    await submit("open-poll", tokens[0], q)
    expect(statuses()).toEqual(["accepted", "accepted"])
    const res = await call(resultsR.GET, "GET", "/x", { auth: admin, params: { pollid: "open-poll" } })
    expect((res.data as { totals: { verified: number; unverified: number } }).totals).toMatchObject({ verified: 2, unverified: 0 })
  })

  it("the public page never reveals whether a link was used", async () => {
    const admin = await setupAdmin()
    const { tokens, q } = await makePoll(admin)
    const get = () => call(publicR.GET, "GET", `/x?t=${tokens[0]}`, { params: { pollid: "lunch" } })
    const before = (await get()).text
    await submit("lunch", tokens[0], q)
    expect((await get()).text).toBe(before)
    expect(before).not.toMatch(/used|verified|repeat/i)
  })
})

describe("public poll access", () => {
  it("gives one generic 404 for wrong poll, bad token, revoked link, trashed poll", async () => {
    const admin = await setupAdmin()
    const { tokens, batchId } = await makePoll(admin)
    await makePoll(admin, "other", 1)
    const otherTok = (db.prepare("SELECT token FROM links WHERE poll_id='other'").get() as { token: string }).token
    const get = (id: string, t: string) => call(publicR.GET, "GET", `/x?t=${t}`, { params: { pollid: id } })
    expect((await get("lunch", tokens[0])).status).toBe(200)
    const bodies = [
      await get("lunch", otherTok), // token from another poll
      await get("lunch", "A".repeat(24)), // unknown token
      await get("lunch", "short"),
      await get("nope", tokens[0]),
      await get("lunch", ""),
    ]
    for (const b of bodies) expect(b.status).toBe(404)
    expect(new Set(bodies.map((b) => b.text)).size).toBe(1)
    await call(revokeBatchR.POST, "POST", "/x", { auth: admin, params: { batchid: String(batchId) } })
    expect((await get("lunch", tokens[1])).status).toBe(404)
    await call(actionR.POST, "POST", "/x", { auth: admin, params: { pollid: "other" }, body: { action: "trash" } })
    expect((await get("other", otherTok)).status).toBe(404)
  })

  it("reports closed and not-open states and rejects submissions", async () => {
    const admin = await setupAdmin()
    const { tokens, q } = await makePoll(admin)
    await call(actionR.POST, "POST", "/x", { auth: admin, params: { pollid: "lunch" }, body: { action: "close" } })
    const g = await call(publicR.GET, "GET", `/x?t=${tokens[0]}`, { params: { pollid: "lunch" } })
    expect(g.data).toMatchObject({ state: "closed", questions: [] })
    expect((await submit("lunch", tokens[0], q)).status).toBe(409)
    await call(pollR.PATCH, "PATCH", "/x", { auth: admin, params: { pollid: "lunch" }, body: { status: "draft" } })
    expect((await call(publicR.GET, "GET", `/x?t=${tokens[0]}`, { params: { pollid: "lunch" } })).data.state).toBe("not_open")
    expect(statuses()).toEqual([])
  })

  it("validates answers server-side", async () => {
    const admin = await setupAdmin()
    const { tokens, q } = await makePoll(admin)
    const post = (body: unknown) => call(submitR.POST, "POST", "/x", { params: { pollid: "lunch" }, body })
    expect((await post({ token: tokens[0], answers: [] })).status).toBe(400) // required missing
    expect((await post({ token: tokens[0], answers: [{ questionId: q[0].id, optionIds: [999999] }] })).status).toBe(400)
    expect((await post({ token: tokens[0], answers: [{ questionId: q[0].id, optionIds: [q[0].options[0].id, q[0].options[1].id] }] })).status).toBe(400)
    expect((await post({ token: tokens[0], answers: [{ questionId: q[0].id, optionIds: [q[0].options[0].id], admin: true }] })).status).toBe(400)
    expect((await post({ token: tokens[0], extra: 1, answers: [] })).status).toBe(400)
    expect((await post({ token: tokens[0], answers: [{ questionId: q[0].id, optionIds: [q[0].options[0].id] }, { questionId: q[1].id, text: "x".repeat(2001) }] })).status).toBe(400)
    const big = await call(submitR.POST, "POST", "/x", { params: { pollid: "lunch" }, raw: JSON.stringify({ token: "x", pad: "y".repeat(40_000) }), headers: { "content-type": "application/json" } })
    expect(big.status).toBe(413)
    expect(statuses()).toEqual([])
  })

  it("stores no IP, user agent or precise time", async () => {
    const admin = await setupAdmin()
    const { tokens, q } = await makePoll(admin)
    await submit("lunch", tokens[0], q, {
      "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17) UNIQUE-UA-MARKER",
      "x-forwarded-for": "203.0.113.77",
      "accept-language": "fr-CA,fr;q=0.9",
      referer: "https://example.com/UNIQUE-REFERER",
    })
    const row = db.prepare("SELECT * FROM responses").get() as Record<string, string>
    expect(row.device_class).toBe("mobile")
    expect(row.language).toBe("fr")
    expect(row.submitted_at).toMatch(/T\d\d:00:00\.000Z$/)
    const dump = JSON.stringify(db.prepare("SELECT * FROM responses").all()) + JSON.stringify(db.prepare("SELECT * FROM audit_log").all())
    for (const needle of ["UNIQUE-UA-MARKER", "203.0.113.77", "UNIQUE-REFERER", "Mozilla"]) expect(dump).not.toContain(needle)
    // Respondent-facing tables only: staff-side IP capture (bots, audit) is opt-in and tested separately.
    const cols = (db.prepare("SELECT m.name AS t, p.name AS c FROM sqlite_master m, pragma_table_info(m.name) p WHERE m.type='table' AND m.name IN ('responses','answers','links','link_batches','polls','questions','options')").all() as { t: string; c: string }[]).map((r) => r.c)
    expect(cols.filter((c) => /^ip$|_ip$|^ip_|agent|referr|fingerprint/i.test(c))).toEqual([])
    const responseEvent = db.prepare("SELECT at, ip, user_agent FROM audit_log WHERE action = 'response_submitted'").get() as { at: string; ip: string | null; user_agent: string | null }
    expect(responseEvent.at).toMatch(/T\d\d:00:00\.000Z$/)
    expect(responseEvent.ip).toBeNull()
    expect(responseEvent.user_agent).toBeNull()
  })
})

describe("setup", () => {
  it("works once, then 404; status flips", async () => {
    expect((await call(statusR.GET, "GET", "/x")).data).toEqual({ setupRequired: true })
    await setupAdmin()
    expect((await call(statusR.GET, "GET", "/x")).data).toEqual({ setupRequired: false })
    const again = await call(setupR.POST, "POST", "/x", { body: { username: "evil", password: PASSWORD } })
    expect(again.status).toBe(404)
    expect(db.prepare("SELECT COUNT(*) AS n FROM users").get()).toEqual({ n: 1 })
  })

  it("concurrent setup creates exactly one admin", async () => {
    const rs = await Promise.all(
      Array.from({ length: 6 }, (_, i) => call(setupR.POST, "POST", "/x", { body: { username: `user${i}`, password: PASSWORD } })),
    )
    expect(rs.filter((r) => r.status === 201)).toHaveLength(1)
    expect(db.prepare("SELECT COUNT(*) AS n FROM users").get()).toEqual({ n: 1 })
  })

  it("requires SETUP_TOKEN when configured", async () => {
    process.env.SETUP_TOKEN = "s3cret-setup-token"
    try {
      expect((await call(setupR.POST, "POST", "/x", { body: { username: "admin", password: PASSWORD } })).status).toBe(403)
      expect((await call(setupR.POST, "POST", "/x", { body: { username: "admin", password: PASSWORD, setupToken: "nope" } })).status).toBe(403)
      expect((await call(setupR.POST, "POST", "/x", { body: { username: "admin", password: PASSWORD, setupToken: "s3cret-setup-token" } })).status).toBe(201)
    } finally {
      delete process.env.SETUP_TOKEN
    }
  })

  it("rejects weak passwords", async () => {
    for (const pw of ["short", "password1234", "aaaaaaaaaaaaaa", "x".repeat(300)]) {
      expect((await call(setupR.POST, "POST", "/x", { body: { username: "admin", password: pw } })).status).toBe(400)
    }
  })
})

describe("authentication", () => {
  it("login issues a fresh session; logout destroys it server-side", async () => {
    await setupAdmin()
    const r = await call(loginR.POST, "POST", "/x", { body: { username: "ADMIN", password: PASSWORD } })
    expect(r.status).toBe(200)
    const sc = r.headers.get("set-cookie")!
    expect(sc).toMatch(/HttpOnly/)
    expect(sc).toMatch(/SameSite=Strict/)
    const auth = authFrom(r)
    expect((await call(meR.GET, "GET", "/x", { auth })).status).toBe(200)
    await call(logoutR.POST, "POST", "/x", { auth })
    expect((await call(meR.GET, "GET", "/x", { auth })).status).toBe(401)
  })

  it("stores only a hash of the session id", async () => {
    const admin = await setupAdmin()
    const id = admin.cookie.split("=")[1]
    const rows = JSON.stringify(db.prepare("SELECT * FROM sessions").all())
    expect(rows).not.toContain(id)
    expect(sessionFromId(db, id)?.user.username).toBe("admin")
    expect(cookieName()).toBe("sid")
  })

  it("gives identical errors for unknown user and wrong password", async () => {
    await setupAdmin()
    const a = await call(loginR.POST, "POST", "/x", { body: { username: "admin", password: "wrong-password-123" } })
    const b = await call(loginR.POST, "POST", "/x", { body: { username: "ghost", password: "wrong-password-123" } })
    expect(a.status).toBe(401)
    expect(a.text).toBe(b.text)
  })

  it("locks a username after repeated failures, even with the right password", async () => {
    await setupAdmin()
    for (let i = 0; i < 5; i++) await call(loginR.POST, "POST", "/x", { body: { username: "admin", password: "wrong-password-123" } })
    const r = await call(loginR.POST, "POST", "/x", { body: { username: "admin", password: PASSWORD } })
    expect(r.status).toBe(429)
    const ghost: number[] = []
    for (let i = 0; i < 6; i++) ghost.push((await call(loginR.POST, "POST", "/x", { body: { username: "ghost", password: "x" } })).status)
    expect(ghost[5]).toBe(429)
  })

  it("expires idle sessions and sessions of disabled users", async () => {
    const admin = await setupAdmin()
    const mk = await call(usersR.POST, "POST", "/x", { auth: admin, body: { username: "edit", role: "editor" } })
    const temp = mk.data.temporaryPassword as string
    const ed = authFrom(await call(loginR.POST, "POST", "/x", { body: { username: "edit", password: temp } }))
    await call(userR.PATCH, "PATCH", "/x", { auth: admin, params: { id: String(mk.data.id) }, body: { disabled: true } })
    expect((await call(meR.GET, "GET", "/x", { auth: ed })).status).toBe(401)
    expect((await call(loginR.POST, "POST", "/x", { body: { username: "edit", password: temp } })).status).toBe(401)
    db.prepare("UPDATE sessions SET last_seen_at = '2000-01-01T00:00:00.000Z'").run()
    expect((await call(meR.GET, "GET", "/x", { auth: admin })).status).toBe(401)
  })

  it("forces a password change for temporary passwords", async () => {
    const admin = await setupAdmin()
    const mk = await call(usersR.POST, "POST", "/x", { auth: admin, body: { username: "edit", role: "editor" } })
    const temp = mk.data.temporaryPassword as string
    const ed = authFrom(await call(loginR.POST, "POST", "/x", { body: { username: "edit", password: temp } }))
    expect((await call(pollsR.GET, "GET", "/x", { auth: ed })).status).toBe(403)
    const ch = await call(pwR.POST, "POST", "/x", { auth: ed, body: { current: temp, next: "a-brand-new-passphrase" } })
    expect(ch.status).toBe(200)
    expect((await call(meR.GET, "GET", "/x", { auth: ed })).status).toBe(401) // old session gone
    expect((await call(pollsR.GET, "GET", "/x", { auth: authFrom(ch) })).status).toBe(200)
  })

  it("rejects cross-site and CSRF-less state changes", async () => {
    const admin = await setupAdmin()
    const noCsrf = await call(pollsR.POST, "POST", "/x", { auth: { ...admin, csrf: "wrong" }, body: { id: "aa", title: "t" } })
    expect(noCsrf.status).toBe(403)
    const evil = await call(pollsR.POST, "POST", "/x", { auth: admin, body: { id: "aa", title: "t" }, headers: { origin: "https://evil.example", host: "localhost" } })
    expect(evil.status).toBe(403)
    const site = await call(pollsR.POST, "POST", "/x", { auth: admin, body: { id: "aa", title: "t" }, headers: { "sec-fetch-site": "cross-site" } })
    expect(site.status).toBe(403)
    const form = await call(loginR.POST, "POST", "/x", { raw: "username=a&password=b", headers: { "content-type": "application/x-www-form-urlencoded" } })
    expect(form.status).toBe(415)
  })
})

describe("authorization", () => {
  it("every admin route requires a session (401)", async () => {
    const hs: [unknown, string, Record<string, string>][] = [
      [pollsR.GET, "GET", {}],
      [pollsR.POST, "POST", {}],
      [pollR.GET, "GET", { pollid: "a" }],
      [pollR.PATCH, "PATCH", { pollid: "a" }],
      [pollR.DELETE, "DELETE", { pollid: "a" }],
      [actionR.POST, "POST", { pollid: "a" }],
      [linksR.GET, "GET", { pollid: "a" }],
      [linksR.POST, "POST", { pollid: "a" }],
      [exportR.GET, "GET", { batchid: "1" }],
      [revokeBatchR.POST, "POST", { batchid: "1" }],
      [resultsR.GET, "GET", { pollid: "a" }],
      [usersR.GET, "GET", {}],
      [usersR.POST, "POST", {}],
      [userR.PATCH, "PATCH", { id: "1" }],
      [userR.DELETE, "DELETE", { id: "1" }],
      [resetR.POST, "POST", { id: "1" }],
      [auditR.GET, "GET", {}],
      [settingsR.GET, "GET", {}],
      [settingsR.PATCH, "PATCH", {}],
      [dashR.GET, "GET", {}],
      [meR.GET, "GET", {}],
      [pwR.POST, "POST", {}],
    ]
    for (const [h, m, p] of hs) expect((await call(h, m, "/x", { params: p, body: m === "GET" ? undefined : {} })).status, `${m}`).toBe(401)
  })

  it("editors cannot use admin-only routes or touch another editor's poll", async () => {
    const admin = await setupAdmin()
    const mk = async (u: string) => {
      const r = await call(usersR.POST, "POST", "/x", { auth: admin, body: { username: u, role: "editor" } })
      const tmp = r.data.temporaryPassword as string
      const l = await call(loginR.POST, "POST", "/x", { body: { username: u, password: tmp } })
      const c = await call(pwR.POST, "POST", "/x", { auth: authFrom(l), body: { current: tmp, next: "a-long-passphrase-123" } })
      return authFrom(c)
    }
    const e1 = await mk("ed-one")
    const e2 = await mk("ed-two")
    const { tokens, batchId } = await makePoll(e1, "mine")
    for (const [h, m] of [[usersR.GET, "GET"], [auditR.GET, "GET"], [settingsR.GET, "GET"]] as const) {
      expect((await call(h, m, "/x", { auth: e1 })).status).toBe(403)
    }
    const p = { pollid: "mine" }
    expect((await call(pollR.GET, "GET", "/x", { auth: e2, params: p })).status).toBe(404)
    expect((await call(pollR.PATCH, "PATCH", "/x", { auth: e2, params: p, body: { title: "pwn" } })).status).toBe(404)
    expect((await call(pollR.DELETE, "DELETE", "/x", { auth: e2, params: p, body: { confirm: "mine" } })).status).toBe(404)
    expect((await call(linksR.POST, "POST", "/x", { auth: e2, params: p, body: { count: 1 } })).status).toBe(404)
    expect((await call(resultsR.GET, "GET", "/x", { auth: e2, params: p })).status).toBe(404)
    expect((await call(exportR.GET, "GET", "/x", { auth: e2, params: { batchid: String(batchId) } })).status).toBe(404)
    expect((await call(revokeBatchR.POST, "POST", "/x", { auth: e2, params: { batchid: String(batchId) } })).status).toBe(404)
    expect((await call(actionR.POST, "POST", "/x", { auth: e2, params: p, body: { action: "trash" } })).status).toBe(404)
    expect((await call(pollsR.GET, "GET", "/x", { auth: e2 })).data.polls).toEqual([])
    expect((await call(pollR.GET, "GET", "/x", { auth: admin, params: p })).status).toBe(200)
    expect(tokens.length).toBe(5)
  })

  it("rejects mass assignment", async () => {
    const admin = await setupAdmin()
    await makePoll(admin)
    expect((await call(pollR.PATCH, "PATCH", "/x", { auth: admin, params: { pollid: "lunch" }, body: { ownerId: 99 } })).status).toBe(400)
    expect((await call(pollR.PATCH, "PATCH", "/x", { auth: admin, params: { pollid: "lunch" }, body: { id: "other" } })).status).toBe(400)
    expect((await call(usersR.POST, "POST", "/x", { auth: admin, body: { username: "x1x", role: "editor", password: "abc", disabledAt: null } })).status).toBe(400)
  })

  it("rootadmin cannot be changed through HTTP, and equal-level users cannot manage each other", async () => {
    const admin = await setupAdmin()
    const me = (await call(meR.GET, "GET", "/x", { auth: admin })).data.user as { id: number }
    const p = { id: String(me.id) }
    expect((await call(userR.PATCH, "PATCH", "/x", { auth: admin, params: p, body: { roleIds: [3] } })).status).toBe(403)
    expect((await call(userR.PATCH, "PATCH", "/x", { auth: admin, params: p, body: { disabled: true } })).status).toBe(403)
    expect((await call(userR.DELETE, "DELETE", "/x", { auth: admin, params: p })).status).toBe(403)
    expect(db.prepare("SELECT is_root FROM users WHERE id = ?").get(me.id)).toEqual({ is_root: 1 })

    const a = await call(usersR.POST, "POST", "/x", { auth: admin, body: { username: "admin2", role: "admin" } })
    const b = await call(usersR.POST, "POST", "/x", { auth: admin, body: { username: "admin3", role: "admin" } })
    const login = async (username: string, temporaryPassword: unknown) => {
      const l = await call(loginR.POST, "POST", "/x", { body: { username, password: temporaryPassword } })
      return authFrom(await call(pwR.POST, "POST", "/x", { auth: authFrom(l), body: { current: temporaryPassword, next: "another-long-passphrase" } }))
    }
    const a2 = await login("admin2", a.data.temporaryPassword)
    const a3 = await login("admin3", b.data.temporaryPassword)
    expect((await call(userR.PATCH, "PATCH", "/x", { auth: a2, params: { id: String(b.data.id) }, body: { disabled: true } })).status).toBe(403)
    expect((await call(userR.DELETE, "DELETE", "/x", { auth: a2, params: { id: String(b.data.id) } })).status).toBe(403)
    expect((await call(userR.PATCH, "PATCH", "/x", { auth: admin, params: { id: String(b.data.id) }, body: { disabled: true } })).status).toBe(200)
    expect((await call(userR.PATCH, "PATCH", "/x", { auth: a3, params: { id: String(a.data.id) }, body: { disabled: true } })).status).toBe(401)
  })

  it("admin password reset forces change and kills sessions", async () => {
    const admin = await setupAdmin()
    const mk = await call(usersR.POST, "POST", "/x", { auth: admin, body: { username: "edit", role: "editor" } })
    const l = await call(loginR.POST, "POST", "/x", { body: { username: "edit", password: mk.data.temporaryPassword } })
    const ed = authFrom(await call(pwR.POST, "POST", "/x", { auth: authFrom(l), body: { current: mk.data.temporaryPassword, next: "another-long-passphrase" } }))
    expect((await call(resetR.POST, "POST", "/x", { auth: ed, params: { id: String(mk.data.id) } })).status).toBe(403)
    const r = await call(resetR.POST, "POST", "/x", { auth: admin, params: { id: String(mk.data.id) } })
    expect(typeof r.data.temporaryPassword).toBe("string")
    expect(db.prepare("SELECT must_change_password AS m FROM users WHERE username='edit'").get()).toEqual({ m: 1 })
  })
})

describe("links and export", () => {
  it("exports exactly N unique URLs built from PUBLIC_BASE_URL", async () => {
    process.env.PUBLIC_BASE_URL = "https://polls.example.org/"
    try {
      const admin = await setupAdmin()
      const { batchId } = await makePoll(admin, "lunch", 100)
      const r = await call(exportR.GET, "GET", "/x?format=txt", { auth: admin, params: { batchid: String(batchId) }, headers: { host: "evil.example" } })
      const lines = r.text.trim().split("\n")
      expect(lines).toHaveLength(100)
      expect(new Set(lines).size).toBe(100)
      for (const l of lines) expect(l).toMatch(/^https:\/\/polls\.example\.org\/poll\/lunch\?t=[A-Za-z0-9_-]{22,}$/)
      expect(r.headers.get("content-disposition")).toMatch(/attachment/)
    } finally {
      delete process.env.PUBLIC_BASE_URL
    }
  })

  it("enforces 1..10000 and neutralizes CSV formulas in labels", async () => {
    const admin = await setupAdmin()
    await call(pollsR.POST, "POST", "/x", { auth: admin, body: { id: "aa", title: "t" } })
    const p = { pollid: "aa" }
    for (const count of [0, -1, 10001, 1.5, "5"]) expect((await call(linksR.POST, "POST", "/x", { auth: admin, params: p, body: { count } })).status).toBe(400)
    const ok = await call(linksR.POST, "POST", "/x", { auth: admin, params: p, body: { count: 3, label: '=HYPERLINK("http://evil")' } })
    expect(ok.status).toBe(201)
    const csv = await call(exportR.GET, "GET", "/x?format=csv", { auth: admin, params: { batchid: String(ok.data.batchId) } })
    const rows = csv.text.trim().split("\r\n")
    expect(rows[0]).toBe("token,url,batch_label")
    expect(rows).toHaveLength(4)
    expect(rows[1]).toContain(`"'=HYPERLINK(""http://evil"")"`)
    expect((await call(exportR.GET, "GET", "/x?format=exe", { auth: admin, params: { batchid: String(ok.data.batchId) } })).status).toBe(400)
  })
})

describe("poll management", () => {
  it("locks structure once responses exist but allows wording changes", async () => {
    const admin = await setupAdmin()
    const { tokens, q } = await makePoll(admin)
    await submit("lunch", tokens[0], q)
    const p = { pollid: "lunch" }
    const same = [
      { id: q[0].id, prompt: "Renamed", type: "single", required: true, options: q[0].options.map((o, i) => ({ id: o.id, label: `L${i}` })) },
      { id: q[1].id, prompt: "Say more", type: "text", required: false, options: [] },
    ]
    expect((await call(pollR.PATCH, "PATCH", "/x", { auth: admin, params: p, body: { questions: same } })).status).toBe(200)
    expect((await call(pollR.PATCH, "PATCH", "/x", { auth: admin, params: p, body: { questions: same.slice(0, 1) } })).status).toBe(409)
    expect((await call(pollR.PATCH, "PATCH", "/x", { auth: admin, params: p, body: { questions: QUESTIONS } })).status).toBe(409)
  })

  it("delete needs the slug; reserved and malformed ids are refused", async () => {
    const admin = await setupAdmin()
    for (const id of ["users", "Bad_Id", "-x", "a", "../x", "x".repeat(61)]) {
      expect((await call(pollsR.POST, "POST", "/x", { auth: admin, body: { id, title: "t" } })).status, id).toBe(400)
    }
    await makePoll(admin)
    const p = { pollid: "lunch" }
    expect((await call(pollR.DELETE, "DELETE", "/x", { auth: admin, params: p, body: { confirm: "nope" } })).status).toBe(400)
    expect((await call(pollR.DELETE, "DELETE", "/x", { auth: admin, params: p, body: { confirm: "lunch" } })).status).toBe(200)
    expect(db.prepare("SELECT COUNT(*) AS n FROM links").get()).toEqual({ n: 0 })
  })

  it("scheduled jobs open, close, purge trash and expire old responses", async () => {
    const admin = await setupAdmin()
    const { tokens, q } = await makePoll(admin)
    await submit("lunch", tokens[0], q)
    db.prepare("UPDATE responses SET submitted_at = '2000-01-01T00:00:00.000Z'").run()
    db.prepare("UPDATE polls SET closes_at = '2000-01-01T00:00:00.000Z'").run()
    runJobs(db)
    expect(db.prepare("SELECT status FROM polls").get()).toEqual({ status: "closed" })
    expect(db.prepare("SELECT COUNT(*) AS n FROM responses").get()).toEqual({ n: 0 })
    await call(actionR.POST, "POST", "/x", { auth: admin, params: { pollid: "lunch" }, body: { action: "trash" } })
    db.prepare("UPDATE polls SET deleted_at = '2000-01-01T00:00:00.000Z'").run()
    runJobs(db)
    expect(db.prepare("SELECT COUNT(*) AS n FROM polls").get()).toEqual({ n: 0 })
  })

  it("settings: base URL validation and audit log has no personal data", async () => {
    const admin = await setupAdmin()
    expect((await call(settingsR.PATCH, "PATCH", "/x", { auth: admin, body: { publicBaseUrl: "javascript:alert(1)" } })).status).toBe(400)
    expect((await call(settingsR.PATCH, "PATCH", "/x", { auth: admin, body: { publicBaseUrl: "https://a.example/p/?x=1" } })).status).toBe(400)
    expect((await call(settingsR.PATCH, "PATCH", "/x", { auth: admin, body: { publicBaseUrl: "https://a.example/" } })).data.publicBaseUrl).toBe("https://a.example")
    const log = (await call(auditR.GET, "GET", "/x", { auth: admin })).text
    expect(log).toContain("settings_changed")
    expect(log).not.toMatch(/password|\d+\.\d+\.\d+\.\d+/i)
  })
})

describe("full export and audit trail", () => {
  it("admin gets every tracked field; editors and anonymous are refused", async () => {
    const admin = await setupAdmin()
    const { tokens, q } = await makePoll(admin)
    await submit("lunch", tokens[0], q, { "user-agent": "iPhone Mobile", "accept-language": "de-DE" })
    await submit("lunch", tokens[0], q)
    const r = await call(fullR.GET, "GET", "/x?poll=lunch&format=json", { auth: admin })
    expect(r.status).toBe(200)
    const d = r.data as { polls: { links: unknown[]; responses: { link_token: string; status: string; device_class: string; language: string; submitted_at: string; answers: { option: string | null }[] }[]; owner: { username: string } }[]; users: Record<string, unknown>[] }
    const p = d.polls[0]
    expect(p.links).toHaveLength(5)
    expect(p.owner.username).toBe("admin")
    expect(p.responses.map((x) => x.status)).toEqual(["verified", "unverified"])
    expect(p.responses[0]).toMatchObject({ link_token: tokens[0], device_class: "mobile", language: "de" })
    expect(p.responses[0].answers[0].option).toBe("A")
    expect(JSON.stringify(d)).not.toMatch(/password_hash|\$argon2/)
    const csv = await call(fullR.GET, "GET", "/x?format=csv", { auth: admin })
    expect(csv.text.split("\r\n")[0]).toContain("link_token")
    expect(csv.text).toContain("unverified")
    expect((await call(fullR.GET, "GET", "/x")).status).toBe(401)
    const mk = await call(usersR.POST, "POST", "/x", { auth: admin, body: { username: "editor1", role: "editor" } })
    const l = await call(loginR.POST, "POST", "/x", { body: { username: "editor1", password: mk.data.temporaryPassword } })
    const ed = authFrom(await call(pwR.POST, "POST", "/x", { auth: authFrom(l), body: { current: mk.data.temporaryPassword, next: "a-long-passphrase-123" } }))
    expect((await call(fullR.GET, "GET", "/x", { auth: ed })).status).toBe(403)
    const log = (await call(auditR.GET, "GET", "/x?action=access_denied", { auth: admin })).text
    expect(log).toContain("access_denied")
    const exp = (await call(auditR.GET, "GET", "/x?action=full_export", { auth: admin })).data.entries as unknown[]
    expect(exp.length).toBe(2)
  })

  it("records failed logins, lockouts and password failures", async () => {
    const admin = await setupAdmin()
    for (let i = 0; i < 6; i++) await call(loginR.POST, "POST", "/x", { body: { username: "admin", password: "wrong-password-123" } })
    await call(pwR.POST, "POST", "/x", { auth: admin, body: { current: "nope-nope-nope-1", next: "another-long-passphrase" } })
    await call(resultsR.GET, "GET", "/x", { auth: admin, params: { pollid: "none" } })
    const actions = (db.prepare("SELECT action FROM audit_log").all() as { action: string }[]).map((a) => a.action)
    expect(actions).toEqual(expect.arrayContaining(["login_failed", "login_blocked_locked", "password_change_failed"]))
  })
})

describe("sharing polls", () => {
  async function editor(admin: Auth, name: string) {
    const r = await call(usersR.POST, "POST", "/x", { auth: admin, body: { username: name, role: "editor" } })
    const l = await call(loginR.POST, "POST", "/x", { body: { username: name, password: r.data.temporaryPassword } })
    const c = await call(pwR.POST, "POST", "/x", { auth: authFrom(l), body: { current: r.data.temporaryPassword, next: "a-long-passphrase-123" } })
    return { auth: authFrom(c), id: r.data.id as number }
  }
  const p = { pollid: "mine" }

  it("view and edit levels grant exactly what they should", async () => {
    const admin = await setupAdmin()
    const owner = await editor(admin, "owner1")
    const viewer = await editor(admin, "viewer1")
    const editr = await editor(admin, "editor2")
    const { tokens, q, batchId } = await makePoll(owner.auth, "mine")
    await submit("mine", tokens[0], q)

    // not shared yet: indistinguishable from missing
    expect((await call(pollR.GET, "GET", "/x", { auth: viewer.auth, params: p })).status).toBe(404)
    expect((await call(sharesR.GET, "GET", "/x", { auth: viewer.auth, params: p })).status).toBe(404)

    // only owner/admin can share; unknown or self shares fail
    expect((await call(sharesR.POST, "POST", "/x", { auth: viewer.auth, params: p, body: { username: "viewer1", permission: "edit" } })).status).toBe(404)
    expect((await call(sharesR.POST, "POST", "/x", { auth: owner.auth, params: p, body: { username: "nobody", permission: "view" } })).status).toBe(404)
    expect((await call(sharesR.POST, "POST", "/x", { auth: owner.auth, params: p, body: { username: "owner1", permission: "view" } })).status).toBe(400)
    expect((await call(sharesR.POST, "POST", "/x", { auth: owner.auth, params: p, body: { username: "viewer1", permission: "root" } })).status).toBe(400)
    expect((await call(sharesR.POST, "POST", "/x", { auth: owner.auth, params: p, body: { username: "viewer1", permission: "view", extra: 1 } })).status).toBe(400)
    expect((await call(sharesR.POST, "POST", "/x", { auth: owner.auth, params: p, body: { username: "viewer1", permission: "view" } })).status).toBe(200)
    expect((await call(sharesR.POST, "POST", "/x", { auth: owner.auth, params: p, body: { username: "editor2", permission: "edit" } })).status).toBe(200)

    // viewer: read only
    expect((await call(pollR.GET, "GET", "/x", { auth: viewer.auth, params: p })).data.access).toBe("view")
    expect((await call(resultsR.GET, "GET", "/x", { auth: viewer.auth, params: p })).status).toBe(200)
    expect((await call(linksR.GET, "GET", "/x", { auth: viewer.auth, params: p })).status).toBe(403)
    expect((await call(pollR.PATCH, "PATCH", "/x", { auth: viewer.auth, params: p, body: { title: "x" } })).status).toBe(403)
    expect((await call(linksR.POST, "POST", "/x", { auth: viewer.auth, params: p, body: { count: 1 } })).status).toBe(403)
    expect((await call(exportR.GET, "GET", "/x?format=txt", { auth: viewer.auth, params: { batchid: String(batchId) } })).status).toBe(403)
    expect((await call(revokeBatchR.POST, "POST", "/x", { auth: viewer.auth, params: { batchid: String(batchId) } })).status).toBe(403)
    expect((await call(revokeLinkR.POST, "POST", "/x", { auth: viewer.auth, params: p, body: { token: tokens[1] } })).status).toBe(403)
    expect((await call(actionR.POST, "POST", "/x", { auth: viewer.auth, params: p, body: { action: "close" } })).status).toBe(403)
    expect((await call(fullR.GET, "GET", "/x", { auth: viewer.auth })).status).toBe(403)
    const dup = await call(actionR.POST, "POST", "/x", { auth: viewer.auth, params: p, body: { action: "duplicate", newId: "viewer-copy" } })
    expect(dup.status).toBe(201)
    expect((await call(pollR.GET, "GET", "/x", { auth: viewer.auth, params: { pollid: "viewer-copy" } })).data.access).toBe("owner")

    // editor: can work on it, cannot trash, delete or share
    expect((await call(pollR.PATCH, "PATCH", "/x", { auth: editr.auth, params: p, body: { title: "Renamed" } })).status).toBe(200)
    expect((await call(linksR.POST, "POST", "/x", { auth: editr.auth, params: p, body: { count: 2 } })).status).toBe(201)
    expect((await call(actionR.POST, "POST", "/x", { auth: editr.auth, params: p, body: { action: "close" } })).status).toBe(200)
    expect((await call(actionR.POST, "POST", "/x", { auth: editr.auth, params: p, body: { action: "trash" } })).status).toBe(403)
    expect((await call(pollR.DELETE, "DELETE", "/x", { auth: editr.auth, params: p, body: { confirm: "mine" } })).status).toBe(403)
    expect((await call(sharesR.POST, "POST", "/x", { auth: editr.auth, params: p, body: { username: "viewer1", permission: "edit" } })).status).toBe(403)
    expect((await call(sharesR.DELETE, "DELETE", "/x", { auth: editr.auth, params: p, body: { userId: viewer.id } })).status).toBe(403)

    // listing and dashboard include shared polls
    const ids = (await call(pollsR.GET, "GET", "/x", { auth: viewer.auth })).data.polls as { id: string; access: string }[]
    expect(ids.find((x) => x.id === "mine")?.access).toBe("view")

    // public respondents never see any of this, and the audit trail records it
    expect((await call(auditR.GET, "GET", "/x?action=share", { auth: admin })).data.entries as unknown[]).toHaveLength(2)

    // viewer leaves; access is gone
    expect((await call(sharesR.DELETE, "DELETE", "/x", { auth: viewer.auth, params: p, body: { userId: viewer.id } })).status).toBe(200)
    expect((await call(pollR.GET, "GET", "/x", { auth: viewer.auth, params: p })).status).toBe(404)
    // owner removes editor; changing level works too
    expect((await call(sharesR.DELETE, "DELETE", "/x", { auth: owner.auth, params: p, body: { userId: editr.id } })).status).toBe(200)
    expect((await call(pollR.PATCH, "PATCH", "/x", { auth: editr.auth, params: p, body: { title: "x" } })).status).toBe(404)
  })

  it("deleting a user removes their shares, and the full export lists shares", async () => {
    const admin = await setupAdmin()
    const owner = await editor(admin, "owner1")
    const other = await editor(admin, "other1")
    await makePoll(owner.auth, "mine")
    await call(sharesR.POST, "POST", "/x", { auth: owner.auth, params: p, body: { username: "other1", permission: "view" } })
    const exp = await call(fullR.GET, "GET", "/x?poll=mine", { auth: admin })
    expect(JSON.stringify(exp.data)).toContain("other1")
    await call(userR.DELETE, "DELETE", "/x", { auth: admin, params: { id: String(other.id) } })
    expect(db.prepare("SELECT COUNT(*) AS n FROM poll_shares").get()).toEqual({ n: 0 })
  })
})
