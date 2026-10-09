import { route, ownedPoll, requireOn } from "@/lib/server/authz"
import { exact, HttpError, intIn, json, readJson, str } from "@/lib/server/http"
import { audit } from "@/lib/server/audit"
import { baseUrl } from "@/lib/server/links"

export const POST = route<{ pollid: string }>({ perm: ["urls:edit", "urls:delete", "urls:export"] }, async ({ req, db, user, params }) => {
  const poll = ownedPoll(db, user, params.pollid)
  const body = await readJson(req, 32 * 1024)
  exact(body, ["ids", "enabled", "groupId", "copy", "delete", "prefix", "suffix", "find", "replace"])
  if (!Array.isArray(body.ids) || body.ids.length < 1 || body.ids.length > 10_000 || body.ids.some((x) => !Number.isSafeInteger(x) || (x as number) < 1)) throw new HttpError(400, "Select one or more URLs")
  const ids = [...new Set(body.ids as number[])]
  const links = db.prepare(`SELECT rowid AS id, display_title AS title, group_id AS groupId FROM links WHERE poll_id = ? AND rowid IN (${ids.map(() => "?").join(",")})`).all(poll.id, ...ids) as { id: number; title: string; groupId: number | null }[]
  if (links.length !== ids.length) throw new HttpError(404, "Not found")
  const sources = [...new Set(links.map((l) => l.groupId).filter((x): x is number => x !== null))]

  if (body.delete === true) {
    for (const groupId of sources) requireOn(db, user, "urls:delete", { pollId: poll.id, ownerId: poll.owner_id, groupId })
    const hasResponses = db.prepare(`SELECT 1 FROM responses WHERE link_token IN (SELECT token FROM links WHERE poll_id = ? AND rowid IN (${ids.map(() => "?").join(",")})) LIMIT 1`).get(poll.id, ...ids)
    if (hasResponses) throw new HttpError(409, "Selected URLs include responses. Disable or revoke them instead to preserve history.")
    db.transaction(() => {
      db.prepare(`DELETE FROM links WHERE poll_id = ? AND rowid IN (${ids.map(() => "?").join(",")})`).run(poll.id, ...ids)
      audit(db, user.id, "urls_bulk_deleted", { type: "poll", id: poll.id }, { count: ids.length })
    })()
    return json({ ok: true, deleted: ids.length })
  }

  if (body.copy === true) {
    for (const groupId of sources) requireOn(db, user, "urls:export", { pollId: poll.id, ownerId: poll.owner_id, groupId })
    return json({ urls: links.map((l) => `${baseUrl(db)}/poll/${poll.id}?t=${(db.prepare("SELECT token FROM links WHERE rowid = ?").get(l.id) as { token: string }).token}`) })
  }
  if (body.enabled !== undefined) {
    for (const groupId of sources) requireOn(db, user, "urls:edit", { pollId: poll.id, ownerId: poll.owner_id, groupId })
    if (typeof body.enabled !== "boolean") throw new HttpError(400, "Invalid enabled state")
  }
  if (body.groupId !== undefined) {
    for (const groupId of sources) requireOn(db, user, "urls:edit", { pollId: poll.id, ownerId: poll.owner_id, groupId })
    if (body.groupId !== null) {
      const id = intIn(body.groupId, 1, 2 ** 31)
      if (!db.prepare("SELECT 1 FROM distribution_groups WHERE id = ? AND poll_id = ?").get(id, poll.id)) throw new HttpError(404, "Not found")
      requireOn(db, user, "groups:edit", { pollId: poll.id, ownerId: poll.owner_id, groupId: id })
    }
  }
  const rename = body.prefix !== undefined || body.suffix !== undefined || body.find !== undefined || body.replace !== undefined
  if (rename) {
    for (const groupId of sources) requireOn(db, user, "urls:edit", { pollId: poll.id, ownerId: poll.owner_id, groupId })
    for (const f of ["prefix", "suffix", "find", "replace"] as const) if (body[f] !== undefined) str(body[f], 200, { optional: true })
  }
  const update = db.prepare("UPDATE links SET enabled = COALESCE(?, enabled), group_id = CASE WHEN ? = 1 THEN ? ELSE group_id END, display_title = ? WHERE rowid = ? AND poll_id = ?")
  const moved = body.groupId !== undefined
  db.transaction(() => {
    for (const l of links) {
      let title = l.title
      if (rename) {
        const find = typeof body.find === "string" ? body.find : ""
        const replace = typeof body.replace === "string" ? body.replace : ""
        if (find) title = title.split(find).join(replace)
        title = `${typeof body.prefix === "string" ? body.prefix : ""}${title}${typeof body.suffix === "string" ? body.suffix : ""}`.slice(0, 200)
      }
      update.run(body.enabled === undefined ? null : body.enabled ? 1 : 0, moved ? 1 : 0, body.groupId ?? null, title, l.id, poll.id)
    }
    audit(db, user.id, "urls_bulk_updated", { type: "poll", id: poll.id }, { count: ids.length, moved, renamed: rename, enabled: typeof body.enabled === "boolean" ? body.enabled : null })
  })()
  return json({ ok: true, updated: links.length })
})
