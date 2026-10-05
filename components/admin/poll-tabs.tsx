import Link from "next/link"

export default function PollTabs({ pollId, current }: { pollId: string; current: "edit" | "links" | "results" | "share" }) {
  return (
    <nav className="tabs" aria-label="Poll sections">
      {(["edit", "links", "results", "share"] as const).map((t) => (
        <Link key={t} href={`/admin/${pollId}/${t}`} aria-current={t === current ? "page" : undefined}>
          {t[0].toUpperCase() + t.slice(1)}
        </Link>
      ))}
    </nav>
  )
}
