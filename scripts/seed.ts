import { getDb, nowIso } from "../lib/server/db"
import { baseUrl, createBatch } from "../lib/server/links"

// Usage: npm run seed   (create the first admin at /login first)
const db = getDb()
const admin = db.prepare("SELECT id FROM users WHERE role = 'admin' AND disabled_at IS NULL ORDER BY id LIMIT 1").get() as { id: number } | undefined
if (!admin) {
  console.error("No admin yet. Start the app, open /login, create the first admin, then run this again.")
  process.exit(1)
}
const id = "sample-poll"
if (db.prepare("SELECT 1 FROM polls WHERE id = ?").get(id)) {
  console.error("sample-poll already exists.")
  process.exit(1)
}
const now = nowIso()
const batch = db.transaction(() => {
  db.prepare("INSERT INTO polls (id, title, description, status, owner_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?)").run(
    id, "Sample poll", "A tiny poll to try things out.", "open", admin.id, now, now,
  )
  const iq = db.prepare("INSERT INTO questions (poll_id, prompt, type, required, position) VALUES (?,?,?,?,?)")
  const io = db.prepare("INSERT INTO options (question_id, label, position) VALUES (?,?,?)")
  const q1 = Number(iq.run(id, "What should we have for lunch?", "single", 1, 0).lastInsertRowid)
  ;["Pizza", "Salad", "Tacos"].forEach((l, i) => io.run(q1, l, i))
  iq.run(id, "Anything else?", "text", 0, 1)
  return createBatch(db, id, 5, "seed")
})()
const base = baseUrl(db)
const tokens = db.prepare("SELECT token FROM links WHERE batch_id = ? ORDER BY rowid").all(batch) as { token: string }[]
console.log("Created sample-poll with 5 links:")
for (const t of tokens) console.log(`${base}/poll/${id}?t=${t.token}`)
