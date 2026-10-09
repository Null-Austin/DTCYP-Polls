import { cookies } from "next/headers"
import { notFound, redirect } from "next/navigation"
import { getDb } from "./db"
import { cookieName, sessionFromId } from "./auth"
import { loadActor } from "./rbac"
import { holdsAnywhere } from "./rbac"
import type { Permission } from "./permissions"

export async function currentSession() {
  const jar = await cookies()
  const db = getDb()
  const s = sessionFromId(db, jar.get(cookieName())?.value)
  if (!s) return null
  const actor = loadActor(db, s.user.id)
  return actor ? { ...s, user: actor } : null
}

// The server is the source of truth for pages; client guards are only UX.
export async function requireSession() {
  const s = await currentSession()
  if (!s) redirect("/login")
  return s
}

export async function requireAdminPage() {
  const s = await requireSession()
  if (!s.user.isRoot && !s.user.grants.some((g) => g.permission.startsWith("admin:"))) notFound()
  return s
}

export async function requirePermissionPage(permission: Permission) {
  const s = await requireSession()
  if (!holdsAnywhere(getDb(), s.user, permission)) notFound()
  return s
}
