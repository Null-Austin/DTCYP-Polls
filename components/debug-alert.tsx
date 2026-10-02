"use client";

type DebugAlertProps = {
  title: string
  children: React.ReactNode
  tone?: "info" | "success" | "warning" | "error"
}

export default function DebugAlert({ title, children, tone = "info" }: DebugAlertProps) {
  return (
    <div className={`debug-alert debug-alert--${tone}`} role="alert">
      <span className="debug-alert__icon" aria-hidden="true">!</span>
      <div>
        <strong>{title}</strong>
        <p>{children}</p>
      </div>
    </div>
  )
}
