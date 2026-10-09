import { createHash } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { createReadStream } from "node:fs"
import { backupDir, type DB } from "./db"

const NAME = /^manual-[0-9]{8}T[0-9]{6}Z-[a-f0-9]{8}\.db$/

export function resolveBackup(db: DB, name: string) {
  if (!NAME.test(name)) return null
  const file = path.join(backupDir(db), name)
  return fs.existsSync(file) ? file : null
}

export async function checksum(file: string) {
  const hash = createHash("sha256")
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest("hex")
}

export async function backups(db: DB) {
  const dir = backupDir(db)
  fs.mkdirSync(dir, { recursive: true })
  const names = fs.readdirSync(dir).filter((name) => NAME.test(name)).sort().reverse().slice(0, 500)
  return Promise.all(names.map(async (name) => {
    const file = path.join(dir, name)
    const stat = fs.statSync(file)
    return { name, size: stat.size, createdAt: stat.mtime.toISOString(), sha256: await checksum(file) }
  }))
}

export const isBackupName = (name: string) => NAME.test(name)
