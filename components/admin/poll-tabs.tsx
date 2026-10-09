import Link from "next/link"

export default function PollTabs({ pollId, current, canLinks = true, canResults = true, canShare = true }: { pollId: string; current: "edit" | "links" | "results" | "share"; canLinks?: boolean; canResults?: boolean; canShare?: boolean }) {
  const tabs = (["edit", "links", "results", "share"] as const).filter((t) => t === "edit" || (t === "links" && canLinks) || (t === "results" && canResults) || (t === "share" && canShare))
  return (
    <nav className="tabs" aria-label="Poll sections">
      {tabs.map((t) => (
        <Link key={t} href={`/admin/${pollId}/${t}`} aria-current={t === current ? "page" : undefined}>
          {t[0].toUpperCase() + t.slice(1)}
        </Link>
      ))}
    </nav>
  )
}
