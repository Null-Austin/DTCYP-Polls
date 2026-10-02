type StatusBadgeProps = {
  children: React.ReactNode
  tone?: "live" | "closed" | "draft"
}

export default function StatusBadge({ children, tone = "live" }: StatusBadgeProps) {
  return <span className={`status-badge status-badge--${tone}`}>{children}</span>
}
