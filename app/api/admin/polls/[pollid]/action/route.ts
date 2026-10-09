import { route } from "@/lib/server/authz"
import { exact, HttpError, json, readJson } from "@/lib/server/http"
import { ACTIONS, applyAction, duplicatePoll, type Action } from "@/lib/server/poll-actions"

export const POST = route<{ pollid: string }>({ perm: ["polls:publish", "polls:delete", "polls:create"] }, async ({ req, db, user, params }) => {
  const body = await readJson(req, 1024)
  exact(body, ["action", "newId"])
  if (body.action === "duplicate") return json({ id: duplicatePoll(db, user, params.pollid, String(body.newId ?? "")) }, 201)
  if (!ACTIONS.includes(body.action as Action)) throw new HttpError(400, "Unknown action")
  db.transaction(() => applyAction(db, user, params.pollid, body.action as Action))()
  return json({ ok: true })
})
