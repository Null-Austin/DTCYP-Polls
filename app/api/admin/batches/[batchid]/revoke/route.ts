import { route, ownedBatch } from "@/lib/server/authz"
import { json } from "@/lib/server/http"
import { nowIso } from "@/lib/server/db"
import { audit } from "@/lib/server/audit"

export const POST = route<{ batchid: string }>({ access: "user" }, ({ db, user, params }) => {
  const { batch, poll } = ownedBatch(db, user, params.batchid)
  const r = db.prepare("UPDATE links SET revoked_at = ? WHERE batch_id = ? AND revoked_at IS NULL").run(nowIso(), batch.id)
  audit(db, user.id, "batch_revoked", { type: "poll", id: poll.id }, { batch: batch.id, links: r.changes })
  return json({ ok: true, revoked: r.changes })
})
