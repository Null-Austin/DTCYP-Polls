import { getDb, type DB } from "./db"
import { checkOrigin, HttpError, json, notFound, rateLimit } from "./http"
import { csrfOk, sessionFromRequest, type Session } from "./auth"
import { audit } from "./audit"
import { runWithContext, requestContext } from "./request-context"
import { authenticateBearer, botRateLimitPerMinute } from "./bots"
import { can, holdsAnywhere, loadActor, accessLevel, outranks, rankableOfUser, type Actor, type Resource } from "./rbac"
import type { Permission } from "./permissions"

export type Params = Record<string, string>
export type RouteCtx<P extends Params = Params> = { params: Promise<P> }

// Every route declares exactly one of these. There is no default.
export type Meta =
  | { access: "public" }
  | { access: "session"; allowMustChange?: boolean } // any signed-in human (self-service)
  | { access: "authenticated" } // any signed-in human or bot
  | { perm: Permission | Permission[]; allowMustChange?: boolean } // needs ANY of these in some scope; handlers re-check per resource
  | { root: true }

export type Ctx<P extends Params> = {
  req: Request
  db: DB
  params: P
  url: URL
  session: Session | null
  actor: Actor
  user: Actor
}

type Handler<P extends Params> = ((req: Request, rc?: RouteCtx<P>) => Promise<Response>) & { meta: Meta }

// The single authorization gate for every API route. 401 = not signed in, 403 = not allowed.
export function route<P extends Params = Params>(meta: Meta, fn: (c: Ctx<P>) => Promise<Response> | Response): Handler<P> {
  const handler = async (req: Request, rc?: RouteCtx<P>): Promise<Response> => {
    let actorId: number | null = null
    let db: DB | null = null
    return runWithContext(req, async () => {
      try {
        db = getDb()
        const unsafe = !["GET", "HEAD", "OPTIONS"].includes(req.method)
        let session: Session | null = null
        let actor: Actor | null = null
        const bearer = /^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization") ?? "")

        if (bearer) {
          if ("access" in meta && meta.access === "session") throw new HttpError(401, "Not signed in")
          const bot = authenticateBearer(db, bearer[1], requestContext()?.ip ?? null)
          if (!bot) throw new HttpError(401, "Invalid or expired token")
          if (!rateLimit(`bot:${bot.userId}`, botRateLimitPerMinute(db), 60_000)) {
            throw new HttpError(429, "Rate limit exceeded", { retryAfterSeconds: 60 })
          }
          actor = loadActor(db, bot.userId, "token")
          if (!actor) throw new HttpError(401, "Invalid or expired token")
        } else {
          if (unsafe) checkOrigin(req)
          session = sessionFromRequest(db, req)
          actor = session ? loadActor(db, session.user.id) : null
        }
        actorId = actor?.id ?? null

        const isPublic = "access" in meta && meta.access === "public"
        if (!isPublic) {
          if (!actor) throw new HttpError(401, "Not signed in")
          if (session && unsafe && !csrfOk(session.csrf, req.headers.get("x-csrf-token"))) throw new HttpError(403, "Bad CSRF token")
          const allowMust = ("allowMustChange" in meta && meta.allowMustChange) || false
          if (actor.mustChangePassword && !allowMust) throw new HttpError(403, "Password change required", { code: "password_change_required" })
          if ("root" in meta && !actor.isRoot) throw new HttpError(403, "Forbidden")
          if ("perm" in meta) {
            const needed = Array.isArray(meta.perm) ? meta.perm : [meta.perm]
            if (!needed.some((p) => holdsAnywhere(db!, actor!, p))) throw new HttpError(403, "Forbidden")
          }
        }
        const params = rc ? await rc.params : ({} as P)
        return await fn({ req, db, params, url: new URL(req.url), session, actor: actor as Actor, user: actor as Actor })
      } catch (e) {
        if (e instanceof HttpError) {
          if (e.status === 403 && actorId !== null && db) {
            try {
              audit(db, actorId, "access_denied", { type: "route", id: new URL(req.url).pathname.slice(0, 120) }, { method: req.method, reason: e.message }, "denied")
            } catch {}
          }
          const headers = e.status === 429 ? { "Retry-After": "60" } : undefined
          return json({ error: e.message, ...e.extra }, e.status, headers)
        }
        console.error("api error:", e instanceof Error ? e.message : "unknown") // never log request data
        return json({ error: "Server error" }, 500)
      }
    })
  }
  return Object.assign(handler, { meta })
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
export type PollAccess = PollRow & { access: Level }

// No visibility at all looks like a missing poll (404); visible but not permitted is a 403.
export function ownedPoll(
  db: DB,
  actor: Actor,
  pollId: string,
  opts: { includeDeleted?: boolean; need?: Permission } = {},
): PollAccess {
  const p = db.prepare("SELECT * FROM polls WHERE id = ?").get(pollId) as PollRow | undefined
  if (!p || (p.deleted_at && !opts.includeDeleted)) throw notFound()
  const res: Resource = { pollId: p.id, ownerId: p.owner_id }
  if (!can(db, actor, "polls:read", res)) throw notFound()
  if (opts.need && !can(db, actor, opts.need, res)) throw new HttpError(403, "Forbidden")
  return { ...p, access: accessLevel(db, actor, p) }
}

export function ownedBatch(db: DB, actor: Actor, batchId: string, need: Permission = "urls:read") {
  const id = Number(batchId)
  const b = Number.isInteger(id)
    ? (db.prepare("SELECT * FROM link_batches WHERE id = ?").get(id) as
        | { id: number; poll_id: string; label: string; count: number; created_at: string; archived_at: string | null; position: number }
        | undefined)
    : undefined
  if (!b) throw notFound()
  const poll = ownedPoll(db, actor, b.poll_id)
  if (!can(db, actor, need, { pollId: poll.id, ownerId: poll.owner_id, batchId: b.id })) throw new HttpError(403, "Forbidden")
  return { batch: b, poll }
}

// For handlers that need a per-action permission after the route gate.
export function requireOn(db: DB, actor: Actor, perm: Permission, res: Resource = {}) {
  if (!(res.pollId || res.ownerId !== undefined || res.batchId !== undefined || res.groupId !== undefined ? can(db, actor, perm, res) : holdsAnywhere(db, actor, perm))) {
    throw new HttpError(403, "Forbidden")
  }
}

export function requirePermission(db: DB, actor: Actor, perm: Permission, res: Resource = {}) {
  requireOn(db, actor, perm, res)
}

// All account-management routes use the same strict hierarchy rule.
export function requireHigherLevelThan(db: DB, actor: Actor, targetId: number) {
  const target = rankableOfUser(db, targetId)
  if (!target) throw notFound()
  if (!outranks(actor, target)) throw new HttpError(403, "Your level must be higher than the target account")
  return target
}
