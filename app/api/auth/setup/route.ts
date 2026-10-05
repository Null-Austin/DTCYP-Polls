import { route } from "@/lib/server/authz"
import { exact, json, rateLimit, readJson, HttpError } from "@/lib/server/http"
import { createFirstAdmin, publicUser, setupRequired, startSession } from "@/lib/server/accounts"
import type { User } from "@/lib/server/auth"

export const POST = route({ access: "public" }, async ({ req, db }) => {
  if (!setupRequired(db)) throw new HttpError(404, "Not found")
  if (!rateLimit("setup", 20, 60_000)) throw new HttpError(429, "Too many attempts")
  const body = await readJson(req)
  exact(body, ["username", "email", "password", "setupToken"])
  const id = await createFirstAdmin(db, body)
  const { csrf, headers } = startSession(db, id)
  const user = db.prepare("SELECT id, username, email, role, must_change_password, disabled_at FROM users WHERE id = ?").get(id) as User
  return json({ user: publicUser(user), csrf }, 201, headers)
})
