import { route } from "@/lib/server/authz"
import { exact, HttpError, json, readJson } from "@/lib/server/http"
import { applyAction } from "@/lib/server/poll-actions"

const BULK = ["close", "archive", "trash"] as const

export const POST = route({ access: "user" }, async ({ req, db, user }) => {
  const body = await readJson(req)
  exact(body, ["ids", "action"])
  if (!BULK.includes(body.action as (typeof BULK)[number])) throw new HttpError(400, "Unknown action")
  if (!Array.isArray(body.ids) || body.ids.length === 0 || body.ids.length > 100 || body.ids.some((i) => typeof i !== "string")) {
    throw new HttpError(400, "Invalid ids")
  }
  // All-or-nothing: one inaccessible id aborts the lot.
  db.transaction(() => {
    for (const id of body.ids as string[]) applyAction(db, user, id, body.action as (typeof BULK)[number])
  })()
  return json({ ok: true, count: body.ids.length })
})
