import { getDb, type DB } from "./db"
import { csrfOk, sessionFromRequest, type Session, type User } from "./auth"
import { checkOrigin, HttpError, json, notFound } from "./http"

export type Params = Record<string, string>
export type RouteCtx<P extends Params = Params> = { params: Promise<P> }
type Access = "public" | "user" | "admin"

export type Ctx<P extends Params> = {
  req: Request
  db: DB
  params: P
  url: URL
  session: Session | null
  user: User
}

type Opts = { access: Access; allowMustChange?: boolean }

// The single authorization gate for every API route. 401 = no session, 403 = not allowed.
export function route<P extends Params = Params>(opts: Opts, fn: (c: Ctx<P>) => Promise<Response> | Response) {
  return async (req: Request, rc?: RouteCtx<P>): Promise<Response> => {
    try {
      const db = getDb()
      const unsafe = !["GET", "HEAD", "OPTIONS"].includes(req.method)
      if (unsafe) checkOrigin(req)
      const session = sessionFromRequest(db, req)
      if (opts.access !== "public") {
        if (!session) throw new HttpError(401, "Not signed in")
        if (unsafe && !csrfOk(session.csrf, req.headers.get("x-csrf-token"))) throw new HttpError(403, "Bad CSRF token")
        if (session.user.must_change_password && !opts.allowMustChange) {
          throw new HttpError(403, "Password change required", { code: "password_change_required" })
        }
        if (opts.access === "admin" && session.user.role !== "admin") throw new HttpError(403, "Forbidden")
      }
      const params = rc ? await rc.params : ({} as P)
      return await fn({ req, db, params, url: new URL(req.url), session, user: session?.user as User })
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message, ...e.extra }, e.status)
      console.error("api error:", e instanceof Error ? e.message : "unknown") // never log request data
      return json({ error: "Server error" }, 500)
    }
  }
}

export type PollRow = {
  id: string
  title: string
  description: string
  status: "draft" | "open" | "closed"
  owner_id: number
  require_verification: number
  opens_at: string | null
  closes_at: string | null
  archived_at: string | null
  deleted_at: string | null
  created_at: string
  updated_at: string
}

// Editors only reach their own polls; others look the same as missing ones.
export function ownedPoll(db: DB, user: User, pollId: string, opts: { includeDeleted?: boolean } = {}): PollRow {
  const p = db.prepare("SELECT * FROM polls WHERE id = ?").get(pollId) as PollRow | undefined
  if (!p || (user.role !== "admin" && p.owner_id !== user.id) || (p.deleted_at && !opts.includeDeleted)) throw notFound()
  return p
}

export function ownedBatch(db: DB, user: User, batchId: string) {
  const id = Number(batchId)
  const b = Number.isInteger(id)
    ? (db.prepare("SELECT * FROM link_batches WHERE id = ?").get(id) as
        | { id: number; poll_id: string; label: string; count: number; created_at: string }
        | undefined)
    : undefined
  if (!b) throw notFound()
  const poll = ownedPoll(db, user, b.poll_id)
  return { batch: b, poll }
}
