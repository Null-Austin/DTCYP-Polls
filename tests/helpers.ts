import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { closeDb, getDb } from "@/lib/server/db"
import { resetRateLimits } from "@/lib/server/http"
import { resetLockouts } from "@/lib/server/auth"
import * as setupR from "@/app/api/auth/setup/route"

export const PASSWORD = "correct-horse-battery-1"

export function freshDb() {
  const dir = mkdtempSync(path.join(tmpdir(), "polls-"))
  closeDb()
  process.env.DATABASE_PATH = path.join(dir, "test.db")
  delete process.env.SETUP_TOKEN
  resetRateLimits()
  resetLockouts()
  return getDb()
}

type Handler = (req: Request, ctx?: { params: Promise<Record<string, string>> }) => Promise<Response>
export type Auth = { cookie: string; csrf: string }

export async function call(
  handler: unknown,
  method: string,
  url: string,
  o: { body?: unknown; auth?: Auth; params?: Record<string, string>; headers?: Record<string, string>; raw?: string } = {},
) {
  const headers: Record<string, string> = { ...o.headers }
  let body: string | undefined = o.raw
  if (o.body !== undefined) {
    headers["content-type"] = "application/json"
    body = JSON.stringify(o.body)
  }
  if (o.auth) {
    headers.cookie = o.auth.cookie
    if (method !== "GET") headers["x-csrf-token"] = o.auth.csrf
  }
  const req = new Request(`http://localhost${url}`, { method, headers, body })
  const res = await (handler as Handler)(req, { params: Promise.resolve(o.params ?? {}) })
  const text = await res.text()
  let data: Record<string, unknown> = {}
  try {
    data = JSON.parse(text)
  } catch {}
  return { status: res.status, data, text, headers: res.headers }
}

export function authFrom(res: { data: Record<string, unknown>; headers: Headers }): Auth {
  const sc = res.headers.get("set-cookie") ?? ""
  return { cookie: sc.split(";")[0], csrf: res.data.csrf as string }
}

export async function setupAdmin(username = "admin") {
  const r = await call(setupR.POST, "POST", "/api/auth/setup", { body: { username, password: PASSWORD } })
  if (r.status !== 201) throw new Error("setup failed " + r.status + r.text)
  return authFrom(r)
}
