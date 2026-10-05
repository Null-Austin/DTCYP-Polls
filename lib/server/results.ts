import type { DB } from "./db"
import { loadQuestions } from "./polls"
import { linkStats } from "./links"

type Counts = { verified: number; unverified: number }

export function pollResults(db: DB, pollId: string) {
  const bucket = (s: string): keyof Counts => (s === "unverified" ? "unverified" : "verified")
  const rows = db
    .prepare(
      `SELECT a.question_id AS qid, a.option_id AS oid, a.text AS text, r.status AS status
       FROM answers a JOIN responses r ON r.id = a.response_id WHERE r.poll_id = ? ORDER BY a.id`,
    )
    .all(pollId) as { qid: number; oid: number | null; text: string | null; status: string }[]
  const questions = loadQuestions(db, pollId).map((q) => {
    const mine = rows.filter((r) => r.qid === q.id)
    const tally = (pred: (r: (typeof rows)[number]) => boolean): Counts => {
      const c = { verified: 0, unverified: 0 }
      for (const r of mine) if (pred(r)) c[bucket(r.status)]++
      return c
    }
    return {
      id: q.id,
      prompt: q.prompt,
      type: q.type,
      options:
        q.type === "rating"
          ? [1, 2, 3, 4, 5].map((n) => ({ id: n, label: String(n), ...tally((r) => r.text === String(n)) }))
          : q.options.map((o) => ({ id: o.id, label: o.label, ...tally((r) => r.oid === o.id) })),
      texts:
        q.type === "text"
          ? mine.slice(0, 500).map((r) => ({ text: r.text ?? "", status: bucket(r.status) }))
          : [],
    }
  })
  const totals = db
    .prepare(
      `SELECT SUM(status IN ('verified','accepted')) AS verified, SUM(status = 'unverified') AS unverified,
              SUM(device_class = 'mobile') AS mobile, SUM(device_class = 'desktop') AS desktop
       FROM responses WHERE poll_id = ?`,
    )
    .get(pollId) as { verified: number | null; unverified: number | null; mobile: number | null; desktop: number | null }
  return {
    links: linkStats(db, pollId),
    totals: { verified: totals.verified ?? 0, unverified: totals.unverified ?? 0, mobile: totals.mobile ?? 0, desktop: totals.desktop ?? 0 },
    questions,
  }
}
