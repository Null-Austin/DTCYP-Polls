import { requireSession } from "@/lib/server/page-auth"
import { globalPermissions } from "@/lib/server/rbac"
import AdminShell from "@/components/admin/admin-shell"

export const metadata = { title: "Admin", robots: { index: false, follow: false } }

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const s = await requireSession()
  return (
    <AdminShell
      csrf={s.csrf}
      user={{
        username: s.user.kind === "bot" ? `bot:${s.user.username.slice(4)}` : s.user.username,
        role: s.user.role,
        mustChangePassword: s.user.mustChangePassword,
        isRoot: s.user.isRoot,
        permissions: s.user.isRoot ? globalPermissions(s.user) : [...new Set(s.user.grants.map((g) => g.permission))],
        roles: s.user.roles.map((r) => ({ name: r.name, color: r.color })),
      }}
    >
      {children}
    </AdminShell>
  )
}
