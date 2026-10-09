import { route } from "@/lib/server/authz"
import { json } from "@/lib/server/http"
import { destroySession, destroyUserSessions, sessionCookie } from "@/lib/server/auth"
import { audit } from "@/lib/server/audit"

export const POST = route({ access: "session", allowMustChange: true }, ({ db, session, url }) => {
  const all = url.searchParams.get("all") === "1"
  if (all) destroyUserSessions(db, session!.user.id)
  else destroySession(db, session!.id)
  audit(db, session!.user.id, all ? "logout_all" : "logout", { type: "user", id: session!.user.id })
  return json({ ok: true }, 200, { "Set-Cookie": sessionCookie(null, 0) })
})
