type PollOptionProps = {
  label: string
  votes: number
  percentage: number
  selected?: boolean
  accent?: "indigo" | "lime" | "amber"
}

export default function PollOption({
  label,
  votes,
  percentage,
  selected = false,
  accent = "indigo",
}: PollOptionProps) {
  return (
    <div className={`poll-option ${selected ? "poll-option--selected" : ""}`}>
      <div className="poll-option__topline">
        <span className="poll-option__label">
          {selected && <span className="poll-option__check">✓</span>}
          {label}
        </span>
        <span className="poll-option__percentage">{percentage}%</span>
      </div>
      <div className="poll-option__track" aria-hidden="true">
        <span
          className={`poll-option__fill poll-option__fill--${accent}`}
          style={{ width: `${percentage}%` }}
        />
      </div>
      <span className="poll-option__votes">{votes.toLocaleString()} votes</span>
    </div>
  )
}
