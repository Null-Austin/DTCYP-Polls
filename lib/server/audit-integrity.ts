import { createHash } from "node:crypto"

export type AuditRecord = {
  id: number
  at: string
  actor_name: string | null
  action: string
  target_type: string | null
  target_id: string | null
  details: string | null
  request_id: string | null
  ip: string | null
  user_agent: string | null
  result: string
  previous_hash: string | null
}

export function auditHash(row: Omit<AuditRecord, "entry_hash">): string {
  const canonical = [row.id, row.at, row.actor_name, row.action, row.target_type, row.target_id, row.details, row.request_id, row.ip, row.user_agent, row.result, row.previous_hash]
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex")
}

export function verifyAuditRows(rows: (AuditRecord & { entry_hash: string })[]) {
  let previous: string | null = null
  for (const row of rows) {
    if (row.previous_hash !== previous || auditHash(row) !== row.entry_hash) {
      return { valid: false, checked: rows.indexOf(row), failedId: row.id, lastHash: previous }
    }
    previous = row.entry_hash
  }
  return { valid: true, checked: rows.length, failedId: null, lastHash: previous }
}
