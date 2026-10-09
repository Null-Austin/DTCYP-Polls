import fs from "node:fs"
import { createReadStream } from "node:fs"
import { Readable } from "node:stream"
import { route } from "@/lib/server/authz"
import { HttpError, json } from "@/lib/server/http"
import { audit } from "@/lib/server/audit"
import { checksum, isBackupName, resolveBackup } from "@/lib/server/backups"

type P = { name: string }

export const GET = route<P>({ perm: "admin:backups" }, async ({ db, user, params }) => {
  const file = resolveBackup(db, params.name)
  if (!file) throw new HttpError(404, "Not found")
  const hash = await checksum(file)
  const size = fs.statSync(file).size
  audit(db, user.id, "database_backup_downloaded", { type: "backup", id: params.name }, { size, sha256: hash })
  const stream = Readable.toWeb(createReadStream(file)) as ReadableStream
  return new Response(stream, { headers: { "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename="${params.name}"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } })
})

export const DELETE = route<P>({ perm: "admin:backups" }, ({ db, user, params }) => {
  if (!isBackupName(params.name)) throw new HttpError(404, "Not found")
  const file = resolveBackup(db, params.name)
  if (!file) throw new HttpError(404, "Not found")
  fs.unlinkSync(file)
  audit(db, user.id, "database_backup_deleted", { type: "backup", id: params.name })
  return json({ ok: true })
})
