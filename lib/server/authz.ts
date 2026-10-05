import { getDb, type DB } from "./db"
import { csrfOk, sessionFromRequest, type Session, type User } from "./auth"
import { checkOrigin, HttpError, json, notFound } from "./http"
import { audit } from "./audit"

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
    let actor: number | null = null
    try {
      const db = getDb()
      const unsafe = !["GET", "HEAD", "OPTIONS"].includes(req.method)
      if (unsafe) checkOrigin(req)
      const session = sessionFromRequest(db, req)
      actor = session?.user.id ?? null
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
      if (e instanceof HttpError) {
        // Signed-in users who are refused leave a trace (path only, never query strings).
        if (e.status === 403 && actor !== null) {
          try {
            audit(getDb(), actor, "access_denied", { type: "route", id: new URL(req.url).pathname.slice(0, 120) }, { method: req.method, reason: e.message })
          } catch {}
        }
        return json({ error: e.message, ...e.extra }, e.status)
      }
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

export type Level = "view" | "edit" | "owner"
const RANK: Record<Level, number> = { view: 1, edit: 2, owner: 3 }
export type PollAccess = PollRow & { access: Level }

// Owner and admins: everything. Shared users: view or edit. No access at all looks like a missing poll (404);
// access that is too low is a 403.
export function ownedPoll(
  db: DB,
  user: User,
  pollId: string,
  opts: { includeDeleted?: boolean; need?: Level } = {},
): PollAccess {
  const p = db.prepare("SELECT * FROM polls WHERE id = ?").get(pollId) as PollRow | undefined
  if (!p || (p.deleted_at && !opts.includeDeleted)) throw notFound()
  let access: Level | null = user.role === "admin" || p.owner_id === user.id ? "owner" : null
  if (!access) {
    const s = db.prepare("SELECT permission FROM poll_shares WHERE poll_id = ? AND user_id = ?").get(pollId, user.id) as
      | { permission: "view" | "edit" }
      | undefined
    access = s?.permission ?? null
  }
  if (!access) throw notFound()
  if (RANK[access] < RANK[opts.need ?? "owner"]) throw new HttpError(403, "Forbidden")
  return { ...p, access }
}

export function ownedBatch(db: DB, user: User, batchId: string, need: Level = "edit") {
  const id = Number(batchId)
  const b = Number.isInteger(id)
    ? (db.prepare("SELECT * FROM link_batches WHERE id = ?").get(id) as
        | { id: number; poll_id: string; label: string; count: number; created_at: string }
        | undefined)
    : undefined
  if (!b) throw notFound()
  const poll = ownedPoll(db, user, b.poll_id, { need })
  return { batch: b, poll }
}
