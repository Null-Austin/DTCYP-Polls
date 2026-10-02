type DebugButtonProps = {
  children: React.ReactNode
  variant?: "primary" | "secondary" | "quiet" | "danger"
}

export default function DebugButton({ children, variant = "primary" }: DebugButtonProps) {
  return <button className={`debug-button debug-button--${variant}`}>{children}</button>
}
