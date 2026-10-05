export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return
  const { getDb } = await import("./lib/server/db")
  const { runJobs } = await import("./lib/server/jobs")
  const tick = () => {
    try {
      runJobs(getDb())
    } catch (e) {
      console.error("job error:", e instanceof Error ? e.message : "unknown")
    }
  }
  tick()
  setInterval(tick, 60_000).unref()
}
