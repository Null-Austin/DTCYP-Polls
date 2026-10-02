import type { MouseEventHandler, ReactNode } from "react"

type DebugButtonProps = {
  children: ReactNode
  variant?: "primary" | "secondary" | "quiet" | "danger"
  onClick?: MouseEventHandler<HTMLButtonElement>
}

export default function Button({ children, variant = "primary", onClick }: DebugButtonProps) {
  return (
    <button className={`debug-button debug-button--${variant}`} onClick={onClick}>
      {children}
    </button>
  )
}
