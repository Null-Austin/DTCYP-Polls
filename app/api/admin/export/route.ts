import { route } from "@/lib/server/authz"
import { download, HttpError } from "@/lib/server/http"
import { fullExport, flatCsv } from "@/lib/server/export"
import { audit } from "@/lib/server/audit"
import { SLUG } from "@/lib/server/polls"
import { createRequire } from "node:module"
import { createHash } from "node:crypto"
import { PassThrough, Readable } from "node:stream"

const { ZipArchive } = createRequire(import.meta.url)("archiver") as { ZipArchive: new (options?: { zlib?: { level?: number } }) => {
  on(event: "error", listener: (error: Error) => void): void
  pipe(output: PassThrough): void
  append(body: Buffer, options: { name: string }): void
  finalize(): Promise<void>
} }

// Admin-only. Contains link tokens (access credentials) and every tracked response field.
export const GET = route({ perm: "admin:export" }, async ({ db, user, url }) => {
  const poll = url.searchParams.get("poll")
  const format = url.searchParams.get("format") ?? "json"
  if (format !== "json" && format !== "csv" && format !== "zip") throw new HttpError(400, "Invalid format")
  if (poll !== null && !SLUG.test(poll)) throw new HttpError(404, "Not found")
  const data = fullExport(db, poll ? [poll] : null, user)
  audit(db, user.id, "full_export", { type: poll ? "poll" : "all", id: poll ?? "all" }, { format, polls: data.polls.length })
  const name = poll ?? "all-polls"
  if (format === "zip") {
    const jsonBytes = Buffer.from(JSON.stringify(data, null, 2))
    const csvBytes = Buffer.from(flatCsv(data))
    const files = [
      { name: "site-export.json", body: jsonBytes },
      { name: "responses.csv", body: csvBytes },
    ]
    const manifest = Buffer.from(JSON.stringify({
      schemaVersion: data.schemaVersion,
      exportedAt: data.exportedAt,
      scope: data.scope,
      files: files.map((f) => ({ name: f.name, sha256: createHash("sha256").update(f.body).digest("hex"), size: f.body.byteLength })),
    }, null, 2))
    const output = new PassThrough()
    const zip = new ZipArchive({ zlib: { level: 6 } })
    zip.on("error", (e: Error) => output.destroy(e))
    zip.pipe(output)
    for (const file of files) zip.append(file.body, { name: file.name })
    zip.append(manifest, { name: "manifest.json" })
    void zip.finalize()
    return new Response(Readable.toWeb(output) as ReadableStream, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${name}-full-export.zip"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    })
  }
  return format === "csv"
    ? download(flatCsv(data), `${name}-full-export.csv`, "text/csv")
    : download(JSON.stringify(data, null, 2), `${name}-full-export.json`, "application/json")
})
