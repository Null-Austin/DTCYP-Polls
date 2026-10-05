import { getDb } from "../lib/server/db"
import { destroyUserSessions, generatePassword, hashPassword } from "../lib/server/auth"
import { audit } from "../lib/server/audit"

// Usage: npm run reset-admin -- <username>
// Prints a temporary password; the user must change it at next login.
async function main() {
  const username = process.argv[2]
  if (!username) {
    console.error("Usage: npm run reset-admin -- <username>")
    process.exit(1)
  }
  const db = getDb()
  const u = db.prepare("SELECT id FROM users WHERE username = ?").get(username) as { id: number } | undefined
  if (!u) {
    console.error("No such user. If there are no accounts yet, open /login to create the first admin.")
    process.exit(1)
  }
  const temp = generatePassword()
  const hash = await hashPassword(temp)
  db.transaction(() => {
    db.prepare("UPDATE users SET password_hash = ?, must_change_password = 1, disabled_at = NULL WHERE id = ?").run(hash, u.id)
    destroyUserSessions(db, u.id)
    audit(db, null, "cli_password_reset", { type: "user", id: u.id })
  })()
  console.log(`Temporary password for ${username}: ${temp}`)
  console.log("The account is enabled and must choose a new password at next login.")
}

main()
