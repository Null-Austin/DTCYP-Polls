import { randomBytes } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { route } from "@/lib/server/authz"
import { json } from "@/lib/server/http"
import { audit } from "@/lib/server/audit"
import { backupDir } from "@/lib/server/db"
import { backups } from "@/lib/server/backups"

export const GET = route({ perm: "admin:backups" }, async ({ db }) => json({ backups: await backups(db) }))

export const POST = route({ perm: "admin:backups" }, async ({ db, user }) => {
  const dir = backupDir(db)
  fs.mkdirSync(dir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")
  const name = `manual-${stamp}-${randomBytes(4).toString("hex")}.db`
  const file = path.join(dir, name)
  await db.backup(file)
  const stat = fs.statSync(file)
  audit(db, user.id, "database_backup_created", { type: "backup", id: name }, { size: stat.size })
  return json({ backup: (await backups(db)).find((b) => b.name === name) }, 201)
})
