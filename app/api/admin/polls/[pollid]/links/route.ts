import { route, ownedPoll, requireOn } from "@/lib/server/authz"
import { exact, HttpError, intIn, json, readJson, str } from "@/lib/server/http"
import { batchList, createBatch, linkStats, MAX_BATCH } from "@/lib/server/links"
import { audit } from "@/lib/server/audit"
import { can } from "@/lib/server/rbac"

type P = { pollid: string }

export const GET = route<P>({ perm: ["urls:read", "urls:create"] }, ({ db, user, params, url }) => {
  const poll = ownedPoll(db, user, params.pollid, { need: "polls:read" })
  requireOn(db, user, "urls:read", { pollId: poll.id, ownerId: poll.owner_id })
  const q = (url.searchParams.get("q") ?? "").slice(0, 64)
  let matches: unknown[] | undefined
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, "\\$&")}%`
    matches = db
      .prepare(
         `SELECT l.rowid AS id, l.token, l.display_title AS title, l.notes, l.enabled, l.group_id AS groupId, l.revoked_at AS revokedAt, b.label,
          (SELECT COUNT(*) FROM responses r WHERE r.link_token = l.token AND r.status IN ('verified','accepted')) AS verified,
          (SELECT COUNT(*) FROM responses r WHERE r.link_token = l.token AND r.status = 'unverified') AS unverified
         FROM links l JOIN link_batches b ON b.id = l.batch_id
         WHERE l.poll_id = ? AND l.token LIKE ? ESCAPE '\\' LIMIT 50`,
      )
      .all(poll.id, like)
    if (!can(db, user, "responses:read", { pollId: poll.id, ownerId: poll.owner_id })) {
      matches = (matches as { verified: number; unverified: number }[]).map((m) => ({ ...m, verified: null, unverified: null }))
    }
  }
  const groups = db.prepare("SELECT g.id, g.name, g.position, g.archived_at AS archivedAt, COUNT(l.rowid) AS urls FROM distribution_groups g LEFT JOIN links l ON l.group_id = g.id WHERE g.poll_id = ? GROUP BY g.id ORDER BY g.position, g.id").all(poll.id)
  const mayReadResponses = can(db, user, "responses:read", { pollId: poll.id, ownerId: poll.owner_id })
  return json({
    pollTitle: poll.title,
    access: poll.access,
    stats: mayReadResponses ? linkStats(db, poll.id) : { generated: linkStats(db, poll.id).generated, answered: null, repeats: null },
    batches: (batchList(db, poll.id) as { id: number; [key: string]: unknown }[]).map((b) => mayReadResponses ? b : { ...b, verified: null, unverified: null }),
    groups,
    matches,
  })
})

export const POST = route<P>({ perm: ["urls:read", "urls:create"] }, async ({ req, db, user, params }) => {
  const poll = ownedPoll(db, user, params.pollid)
  requireOn(db, user, "urls:create", { pollId: poll.id, ownerId: poll.owner_id })
  const body = await readJson(req, 2048)
  exact(body, ["count", "label", "titles", "input"])
  const label = str(body.label, 100, { optional: true })
  let titles: string[] = []
  let count: number
  const titleSource = body.input ?? body.titles
  if (titleSource !== undefined) {
    if (typeof titleSource !== "string" || titleSource.length > 100_000) throw new HttpError(400, "Invalid URL input")
    const source = titleSource.trim()
    if (/^\d+$/.test(source)) {
      count = intIn(Number(source), 1, MAX_BATCH)
    } else {
      titles = (source.includes("\n") ? source.split(/\r?\n/) : source.split(",")).map((x) => x.trim()).filter(Boolean)
      if (!titles.length) throw new HttpError(400, "Enter a count or at least one title")
      if (titles.length > MAX_BATCH) throw new HttpError(400, `A batch may contain at most ${MAX_BATCH} URLs`)
      if (titles.some((x) => x.length > 200)) throw new HttpError(400, "URL titles are limited to 200 characters")
      count = titles.length
    }
  } else {
    count = intIn(body.count, 1, MAX_BATCH)
  }
  const duplicates = [...new Set(titles.filter((t, i) => titles.findIndex((x) => x.toLocaleLowerCase() === t.toLocaleLowerCase()) !== i))]
  const id = createBatch(db, poll.id, count, label, titles)
  const group = db.prepare("SELECT group_id AS id FROM links WHERE batch_id = ? LIMIT 1").get(id) as { id: number }
  audit(db, user.id, "links_generated", { type: "poll", id: poll.id }, { batch: id, count })
  return json({ batchId: id, groupId: group.id, count, duplicateTitles: duplicates }, 201)
})
