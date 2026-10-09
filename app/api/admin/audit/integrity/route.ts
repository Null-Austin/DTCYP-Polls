import { route } from "@/lib/server/authz"
import { json } from "@/lib/server/http"
import { verifyAuditRows, type AuditRecord } from "@/lib/server/audit-integrity"
import { audit } from "@/lib/server/audit"

export const GET = route({ perm: "audit:read" }, ({ db, user }) => {
  const rows = db.prepare("SELECT id, at, actor_name, action, target_type, target_id, details, request_id, ip, user_agent, result, previous_hash, entry_hash FROM audit_log ORDER BY id").all() as (AuditRecord & { entry_hash: string })[]
  const result = verifyAuditRows(rows)
  audit(db, user.id, "audit_integrity_checked", { type: "audit_log", id: "all" }, { valid: result.valid, checked: result.checked })
  return json(result)
})
