import { route, ownedPoll } from "@/lib/server/authz"
import { exact, intIn, json, readJson, str } from "@/lib/server/http"
import { batchList, createBatch, linkStats, MAX_BATCH } from "@/lib/server/links"
import { audit } from "@/lib/server/audit"

type P = { pollid: string }

export const GET = route<P>({ access: "user" }, ({ db, user, params, url }) => {
  const poll = ownedPoll(db, user, params.pollid)
  const q = (url.searchParams.get("q") ?? "").slice(0, 64)
  let matches: unknown[] | undefined
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, "\\$&")}%`
    matches = db
      .prepare(
        `SELECT l.token, l.revoked_at AS revokedAt, b.label,
          (SELECT COUNT(*) FROM responses r WHERE r.link_token = l.token AND r.status IN ('verified','accepted')) AS verified,
          (SELECT COUNT(*) FROM responses r WHERE r.link_token = l.token AND r.status = 'unverified') AS unverified
         FROM links l JOIN link_batches b ON b.id = l.batch_id
         WHERE l.poll_id = ? AND l.token LIKE ? ESCAPE '\\' LIMIT 50`,
      )
      .all(poll.id, like)
  }
  return json({ pollTitle: poll.title, stats: linkStats(db, poll.id), batches: batchList(db, poll.id), matches })
})

export const POST = route<P>({ access: "user" }, async ({ req, db, user, params }) => {
  const poll = ownedPoll(db, user, params.pollid)
  const body = await readJson(req, 2048)
  exact(body, ["count", "label"])
  const count = intIn(body.count, 1, MAX_BATCH)
  const label = str(body.label, 100, { optional: true })
  const id = createBatch(db, poll.id, count, label)
  audit(db, user.id, "links_generated", { type: "poll", id: poll.id }, { batch: id, count })
  return json({ batchId: id, count }, 201)
})
