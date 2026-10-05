import { cookies } from "next/headers"
import { notFound, redirect } from "next/navigation"
import { getDb } from "./db"
import { cookieName, sessionFromId } from "./auth"

export async function currentSession() {
  const jar = await cookies()
  return sessionFromId(getDb(), jar.get(cookieName())?.value)
}

// The server is the source of truth for pages; client guards are only UX.
export async function requireSession() {
  const s = await currentSession()
  if (!s) redirect("/login")
  return s
}

export async function requireAdminPage() {
  const s = await requireSession()
  if (s.user.role !== "admin") notFound()
  return s
}
