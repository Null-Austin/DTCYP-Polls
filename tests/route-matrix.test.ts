import { describe, expect, it } from "vitest"
import { freshDb } from "./helpers"
import { createSession, sessionCookie } from "@/lib/server/auth"
import { OPENAPI } from "@/lib/server/openapi"

type Meta = { access?: string; perm?: string | string[]; root?: boolean }
type Handler = ((req: Request, ctx?: { params: Promise<Record<string, string>> }) => Promise<Response>) & { meta?: Meta }

const modules = import.meta.glob("../app/api/**/route.ts", { eager: true }) as Record<string, Record<string, unknown>>
const handlers = Object.entries(modules).flatMap(([file, mod]) =>
  Object.entries(mod).filter(([key, value]) => ["GET", "POST", "PUT", "PATCH", "DELETE"].includes(key) && typeof value === "function")
    .map(([method, handler]) => ({ file, method, handler: handler as Handler, meta: (handler as Handler).meta })),
)

async function invoke(handler: Handler, method: string, cookie?: string, csrf?: string) {
  const headers: Record<string, string> = {}
  if (cookie) headers.cookie = cookie
  if (csrf && method !== "GET") headers["x-csrf-token"] = csrf
  if (method !== "GET") headers["content-type"] = "application/json"
  return handler(new Request("http://localhost/api/probe", { method, headers, body: method === "GET" ? undefined : "{}" }), { params: Promise.resolve({ id: "1", pollid: "missing", batchid: "1", groupid: "1", urlid: "1" }) })
}

describe("API route authorization registry", () => {
  it("every exported API method is wrapped with explicit access or permission metadata", () => {
    expect(handlers.length).toBeGreaterThan(30)
    for (const h of handlers) {
      expect(h.meta, `${h.file}:${h.method}`).toBeDefined()
      const meta = h.meta!
      expect(["public", "session", "authenticated"].includes(meta.access ?? "") || !!meta.perm || meta.root === true, `${h.file}:${h.method}`).toBe(true)
      if (h.file.includes("/api/admin/") && meta.access === "public") throw new Error(`Admin endpoint marked public: ${h.file}`)
    }
  })

  it("all non-public endpoints reject anonymous requests before running handlers", async () => {
    freshDb()
    for (const h of handlers) {
      if (h.meta?.access === "public") continue
      const res = await invoke(h.handler, h.method)
      expect(res.status, `${h.method} ${h.file}`).toBe(401)
    }
  })

  it("every /api/v1 route is represented in the OpenAPI spec", () => {
    const documented = new Set(Object.keys(OPENAPI.paths))
    const routes = handlers.filter((h) => h.file.includes("/app/api/v1/") && !h.file.includes("openapi.json"))
    for (const h of routes) {
      const expected = h.file.replace(/^\.\.\/app/, "").replace(/\/route\.ts$/, "").replace(/\[([^\]]+)\]/g, "{$1}")
      expect(documented.has(expected), `${h.method} ${expected}`).toBe(true)
    }
  })

  it("a zero-permission human cannot enter permission or root routes", async () => {
    const db = freshDb()
    const now = new Date().toISOString()
    const userId = Number(db.prepare("INSERT INTO users (username, password_hash, role, created_at) VALUES ('empty-role','x','editor',?)").run(now).lastInsertRowid)
    const roleId = Number(db.prepare("INSERT INTO roles (name, color, level, position, created_at) VALUES ('Empty','#888888',0,20,?)").run(now).lastInsertRowid)
    db.prepare("INSERT INTO user_roles (user_id, role_id) VALUES (?,?)").run(userId, roleId)
    const s = createSession(db, userId)
    const cookie = sessionCookie(s.id, 3600).split(";")[0]
    for (const h of handlers) {
      const meta = h.meta
      if (!meta || meta.access === "public" || meta.access === "session" || meta.access === "authenticated") continue
      const res = await invoke(h.handler, h.method, cookie, s.csrf)
      expect(res.status, `${h.method} ${h.file}`).toBe(403)
    }
  })

  it("a precise permission unlocks its matching resource scope only", async () => {
    const db = freshDb()
    const now = new Date().toISOString()
    const userId = Number(db.prepare("INSERT INTO users (username, password_hash, role, created_at) VALUES ('reader','x','editor',?)").run(now).lastInsertRowid)
    const roleId = Number(db.prepare("INSERT INTO roles (name, color, level, position, created_at) VALUES ('Reader','#2288aa',5,20,?)").run(now).lastInsertRowid)
    db.prepare("INSERT INTO role_permissions (role_id, permission, scope) VALUES (?, 'polls:read', 'own')").run(roleId)
    db.prepare("INSERT INTO user_roles (user_id, role_id) VALUES (?,?)").run(userId, roleId)
    const s = createSession(db, userId)
    const cookie = sessionCookie(s.id, 3600).split(";")[0]
    const polls = handlers.find((h) => h.file.endsWith("/admin/polls/route.ts") && h.method === "GET")!
    const listing = await invoke(polls.handler, "GET", cookie, s.csrf)
    expect(listing.status).toBe(200)
    const users = handlers.find((h) => h.file.endsWith("/admin/users/route.ts") && h.method === "GET")!
    expect((await invoke(users.handler, "GET", cookie, s.csrf)).status).toBe(403)
  })
})
