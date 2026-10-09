import Link from "next/link"
import ExportActions from "./export-actions"

const SECTIONS: { permission: string; label: string; href?: string; description: string }[] = [
  { permission: "admin:settings", label: "Settings", href: "/admin/settings", description: "Retention, sessions and public URL" },
  { permission: "admin:export", label: "Full export", href: "/api/admin/export?format=zip", description: "Download a poll, account, role and audit archive with checksums" },
  { permission: "admin:backups", label: "Backups", href: "/admin/site/backups", description: "Create, download and delete database snapshots" },
  { permission: "admin:branding", label: "Branding", description: "Site name and icon" },
  { permission: "admin:webhooks", label: "Webhooks", description: "Event destinations and delivery history" },
  { permission: "admin:security", label: "Security", href: "/admin/site/security", description: "Sessions and sign-in overview" },
  { permission: "admin:system", label: "System health", href: "/admin/site/system", description: "Database and runtime health" },
  { permission: "admin:logs", label: "System logs", description: "Scheduled jobs and operational events" },
]

export default function AdminHub({ permissions, isRoot }: { permissions: string[]; isRoot: boolean }) {
  const visible = SECTIONS.filter((s) => isRoot || permissions.includes(s.permission))
  const available = visible.filter((s) => s.href)
  const workInProgress = visible.filter((s) => !s.href)
  return (
    <>
      <h1>Admin</h1>
      <p className="admin__sub">Site administration and access-controlled tools.</p>
      {available.map((s) => (
        <section className="panel row" key={s.permission}>
          <div className="grow"><h2 style={{ margin: 0 }}>{s.label}</h2><p className="muted" style={{ margin: "4px 0 0" }}>{s.description}</p></div>
          {s.permission === "admin:export" ? (
            <ExportActions />
          ) : <Link className="btn" href={s.href!}>Open</Link>}
        </section>
      ))}
      {(isRoot || permissions.includes("role:read")) && <section className="panel row"><div className="grow"><h2 style={{ margin: 0 }}>Roles</h2><p className="muted" style={{ margin: "4px 0 0" }}>Manage role permissions and hierarchy levels.</p></div><Link className="btn" href="/admin/roles">Open</Link></section>}
      {workInProgress.length > 0 && (
        <section aria-labelledby="wip-heading" style={{ marginTop: 36 }}>
          <h2 id="wip-heading" className="muted" style={{ fontSize: 14, fontWeight: 600 }}>Work In Progress</h2>
          {workInProgress.map((s) => (
            <section className="panel row" key={s.permission}>
              <div className="grow"><h3 style={{ margin: 0, fontSize: 16 }}>{s.label}</h3><p className="muted" style={{ margin: "4px 0 0" }}>{s.description}</p></div>
              <span className="chip">Work in progress</span>
            </section>
          ))}
        </section>
      )}
    </>
  )
}
