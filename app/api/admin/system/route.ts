import fs from "node:fs"
import path from "node:path"
import { route } from "@/lib/server/authz"
import { json } from "@/lib/server/http"
import { schemaVersion } from "@/lib/server/db"
import { env } from "@/lib/server/env"

export const GET = route({ perm: "admin:system" }, ({ db }) => {
  const file = env.databasePath()
  const size = (p: string) => { try { return fs.statSync(p).size } catch { return 0 } }
  const backupPath = path.join(path.dirname(file), "backups")
  const backups = fs.existsSync(backupPath) ? fs.readdirSync(backupPath).filter((x) => x.endsWith(".db")).length : 0
  const storage = fs.existsSync(path.dirname(file)) ? Number((fs.statfsSync(path.dirname(file)).bsize * fs.statfsSync(path.dirname(file)).blocks)) : 0
  return json({
    appVersion: process.env.APP_VERSION || "0.1.1",
    node: process.version,
    database: { path: file, size: size(file), walSize: size(`${file}-wal`), shmSize: size(`${file}-shm`), migrationVersion: schemaVersion(db) },
    backups: { count: backups },
    storage: { path: path.dirname(file), totalBytes: storage },
    runtime: { uptimeSeconds: Math.floor(process.uptime()), environment: process.env.NODE_ENV || "development" },
  })
})
