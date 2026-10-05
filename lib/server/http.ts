import { env } from "./env"

export class HttpError extends Error {
  constructor(public status: number, message: string, public extra?: Record<string, unknown>) {
    super(message)
  }
}

export const notFound = () => new HttpError(404, "Not found")

export function json(data: unknown, status = 200, headers?: HeadersInit) {
  const h = new Headers(headers)
  h.set("Cache-Control", "no-store")
  h.set("Content-Type", "application/json; charset=utf-8")
  return new Response(JSON.stringify(data), { status, headers: h })
}

const MAX_BODY = 64 * 1024

export async function readJson(req: Request, maxBytes = MAX_BODY): Promise<Record<string, unknown>> {
  const ct = req.headers.get("content-type") ?? ""
  if (!ct.toLowerCase().startsWith("application/json")) throw new HttpError(415, "JSON required")
  const declared = Number(req.headers.get("content-length") ?? 0)
  if (declared > maxBytes) throw new HttpError(413, "Body too large")
  const reader = req.body?.getReader()
  if (!reader) throw new HttpError(400, "Empty body")
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > maxBytes) {
      await reader.cancel()
      throw new HttpError(413, "Body too large")
    }
    chunks.push(value)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"))
  } catch {
    throw new HttpError(400, "Invalid JSON")
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new HttpError(400, "Invalid body")
  return parsed as Record<string, unknown>
}

// Rejects unknown fields (also blocks mass assignment).
export function exact<T extends string>(o: Record<string, unknown>, allowed: readonly T[]): void {
  for (const k of Object.keys(o)) if (!(allowed as readonly string[]).includes(k)) throw new HttpError(400, "Unknown field")
}

export function str(v: unknown, max: number, opts: { min?: number; optional?: boolean } = {}): string {
  if (v === undefined || v === null) {
    if (opts.optional) return ""
    throw new HttpError(400, "Invalid input")
  }
  if (typeof v !== "string") throw new HttpError(400, "Invalid input")
  const s = v.normalize("NFC").trim()
  if (s.length > max || s.length < (opts.min ?? 0)) throw new HttpError(400, "Invalid input")
  return s
}

export function intIn(v: unknown, min: number, max: number): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) throw new HttpError(400, "Invalid input")
  return v
}

// Same-origin check for state-changing requests (defence in depth on top of SameSite=Strict + CSRF token).
export function checkOrigin(req: Request) {
  const site = req.headers.get("sec-fetch-site")
  if (site && site !== "same-origin" && site !== "none") throw new HttpError(403, "Cross-site request refused")
  const origin = req.headers.get("origin")
  if (!origin) return
  let o: URL
  try {
    o = new URL(origin)
  } catch {
    throw new HttpError(403, "Bad origin")
  }
  const host = req.headers.get("host")
  const pub = env.publicBaseUrl()
  if (o.host === host) return
  if (pub && new URL(pub).origin === o.origin) return
  throw new HttpError(403, "Bad origin")
}

// Cell value safe to open in spreadsheets.
export function csvCell(v: string | number): string {
  let s = String(v)
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function download(body: string, filename: string, type: string) {
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "_")
  return new Response(body, {
    headers: {
      "Content-Type": `${type}; charset=utf-8`,
      "Content-Disposition": `attachment; filename="${safe}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  })
}

const buckets = new Map<string, { n: number; reset: number }>()

// In-memory only; keys never contain IPs.
export function rateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now()
  const b = buckets.get(key)
  if (!b || b.reset < now) {
    if (buckets.size > 50_000) for (const [k, v] of buckets) if (v.reset < now) buckets.delete(k)
    buckets.set(key, { n: 1, reset: now + windowMs })
    return true
  }
  b.n++
  return b.n <= max
}

export function resetRateLimits() {
  buckets.clear()
}
