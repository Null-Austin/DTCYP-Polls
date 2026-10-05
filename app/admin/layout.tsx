import { requireSession } from "@/lib/server/page-auth"
import AdminShell from "@/components/admin/admin-shell"

export const metadata = { title: "Admin", robots: { index: false, follow: false } }

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const s = await requireSession()
  return (
    <AdminShell
      csrf={s.csrf}
      user={{ username: s.user.username, role: s.user.role, mustChangePassword: !!s.user.must_change_password }}
    >
      {children}
    </AdminShell>
  )
}
