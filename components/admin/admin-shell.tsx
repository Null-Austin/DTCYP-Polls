"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useState } from "react"
import PollLogo from "@/components/poll/logo"
import AccountPanel from "./account-panel"
import { api, setCsrf } from "@/lib/client/api"

type U = { username: string; role: "admin" | "editor"; mustChangePassword: boolean; isRoot: boolean; permissions: string[]; roles: { name: string; color: string }[] }

export default function AdminShell({ user, csrf, children }: { user: U; csrf: string; children: React.ReactNode }) {
  setCsrf(csrf)
  const path = usePathname()
  const router = useRouter()
  const [menu, setMenu] = useState(false)
  const has = (p: string) => user.isRoot || user.permissions.includes(p)
  const hasAdmin = user.isRoot || user.permissions.some((p) => p.startsWith("admin:"))
  const items: [string, string][] = [["/admin", "Dashboard"]]
  if (has("polls:read")) items.push(["/admin/polls", "Polls"])
  if (has("users:read")) items.push(["/admin/users", "Users"])
  if (has("tokens:read") || has("tokens:create")) items.push(["/admin/bots", "API tokens"])
  if (has("role:read")) items.push(["/admin/roles", "Roles"])
  if (has("audit:read")) items.push(["/admin/audit", "Audit log"])
  if (has("admin:settings")) items.push(["/admin/settings", "Settings"])
  if (hasAdmin) items.push(["/admin/site", "Admin"])
  const here = (href: string) => (href === "/admin" ? path === href : path === href || path.startsWith(href + "/"))

  async function logout(all = false) {
    await api(`/api/auth/logout${all ? "?all=1" : ""}`, { method: "POST" }).catch(() => {})
    router.replace("/login")
    router.refresh()
  }

  return (
    <div className="admin">
      <nav className="admin__nav" aria-label="Main">
        <div className="brand"><PollLogo /></div>
        {items.map(([href, label]) => (
          <Link key={href} href={href} aria-current={here(href) ? "page" : undefined}>{label}</Link>
        ))}
        <div className="spacer" />
        <div className="avatar">
          <button aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>
            <span className="avatar__dot">{user.username.slice(0, 2).toUpperCase()}</span>
            <span>{user.username}</span>
          </button>
          {menu && (
            <div className="avatar__menu" role="menu">
              <Link href="/admin/account" role="menuitem" onClick={() => setMenu(false)}>Account</Link>
              <button className="link" role="menuitem" onClick={() => logout()}>Log out</button>
            </div>
          )}
        </div>
      </nav>
      <main className="admin__main">
        {user.roles.length > 0 && <div className="chips" aria-label="Your roles" style={{ marginBottom: 14 }}>{user.roles.map((r) => <span key={r.name} className="role-pill" style={{ background: r.color }}>{r.name}</span>)}</div>}
        {user.mustChangePassword ? (
          <>
            <h1>Choose a new password</h1>
            <p className="admin__sub">Your password was set by an administrator. Pick your own to continue.</p>
            <AccountPanel forced />
          </>
        ) : (
          children
        )}
      </main>
    </div>
  )
}
