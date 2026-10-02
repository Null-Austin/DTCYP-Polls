import PollOption from "./poll-option"

type PollCardProps = {
  eyebrow: string
  question: string
  description: string
  totalVotes: number
  children: React.ReactNode
  footer?: string
}

export default function PollCard({
  eyebrow,
  question,
  description,
  totalVotes,
  children,
  footer = "Closes in 3 days",
}: PollCardProps) {
  return (
    <article className="poll-card">
      <div className="poll-card__header">
        <span className="status-badge status-badge--live">Live now</span>
        <span className="poll-card__eyebrow">{eyebrow}</span>
      </div>
      <h2 className="poll-card__question">{question}</h2>
      <p className="poll-card__description">{description}</p>
      <div className="poll-card__options">{children}</div>
      <footer className="poll-card__footer">
        <span>{totalVotes.toLocaleString()} total votes</span>
        <span>{footer}</span>
      </footer>
    </article>
  )
}

export { PollOption }
